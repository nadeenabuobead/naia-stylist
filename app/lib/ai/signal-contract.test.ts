// app/lib/ai/signal-contract.test.ts
// Run with: node --experimental-strip-types --test app/lib/ai/signal-contract.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCT_TEMPLATE_FIELDS,
  ALL_PRODUCT_TEMPLATE_FIELD_VALUES,
  RECOMMENDATION_BEHAVIOURS,
  CANDIDATE_POOLS,
  ELIGIBILITY_STATES,
  PRODUCT_ELIGIBILITY,
  SESSION_QUESTION_IDS,
  SESSION_QUESTIONS,
  PROFILE_QUESTION_IDS,
  PROFILE_QUESTIONS,
  BPE_ALIAS_MAP,
  BODY_NEED_NORMALIZATION_MAP,
  STYLE_PERSONALITY_STYLE_TAG_FALLBACK,
  PSM_NORMALIZATION_MAP,
  PSM_SUPPLEMENTAL_PRODUCT_TOKENS,
  PROFILE_DESIRED_FEELING_TRANSLATION,
  PROFILE_SILHOUETTE_SMCM_MAP,
  PROFILE_COVERAGE_PREFERRED_VALUE,
  PROFILE_COVERAGE_MULTI_IDS,
  STYLING_EFFORT_RULE,
  DUAL_MOOD_BONUS,
  ANSWER_REGISTRY,
  PROVISIONAL_EVIDENCE,
  getMappingById,
  getMappingsByIdAndQuestion,
  getAnswersByQuestion,
  resolveAlias,
  isNeutralAnswer,
  getActivatedFields,
  getActivatedFieldsByQuestion,
  getBehaviours,
  isKnownAnswer,
  getCandidatePool,
  isEligible,
  getSessionOverrideCategory,
  isFirmNo,
  isCoverageNonNegotiable,
  getStylingEffortActivationMoods,
  readLifestyle,
} from "./signal-contract.ts";

const PTF = PRODUCT_TEMPLATE_FIELDS;
const B = RECOMMENDATION_BEHAVIOURS;
const SQ = SESSION_QUESTION_IDS;
const PQ = PROFILE_QUESTION_IDS;

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRODUCT_TEMPLATE_FIELDS — 46 fields, correct V7 values
// ─────────────────────────────────────────────────────────────────────────────

describe("PRODUCT_TEMPLATE_FIELDS — structure", () => {
  const EXPECTED_FIELD_VALUES = [
    // Product facts (12)
    "verifiedTitle", "handle", "liveUrl", "featuredImageUrl", "itemType",
    "styleableComponents", "colors", "silhouette", "fit", "fabric",
    "activePublished", "artStoryDescription",
    // Style Me Intelligence (20)
    "stylingRole", "desiredFeelingMatch", "stylePersonalityMatch", "styleTags",
    "occasionTags", "productStyleDescriptors", "formalityScore", "formalityDescription",
    "season", "bodyFitLogic", "bodyProportionEffects", "styleMeComfortMatch",
    "coverageModesty", "proportionRule", "notIdealFor",
    "currentEmotionalStateSupport", "emotionalSupportLogic",
    "practicalSupportMatch", "practicalSupportLogic", "stylingEffortLevel",
    // Pairing Logic (14)
    "bestPairedWithNadinePieces", "conditionalNadinePairings", "avoidPairingWithNadinePieces",
    "bestPairedWithGeneral", "avoidPairingWithGeneral", "pairingReason",
    "accessoriesDirection", "shoeDirection", "colorDirection",
    "skinToneColourHarmony", "complexionStylingNote",
    "hairStylingDirection", "hairStylingNote", "styleMeExplanation",
  ];

  it("has exactly 46 fields", () => {
    assert.equal(Object.keys(PTF).length, 46);
  });

  it("ALL_PRODUCT_TEMPLATE_FIELD_VALUES has exactly 46 entries", () => {
    assert.equal(ALL_PRODUCT_TEMPLATE_FIELD_VALUES.size, 46);
  });

  it("contains all expected camelCase value strings", () => {
    for (const value of EXPECTED_FIELD_VALUES) {
      assert.ok(
        ALL_PRODUCT_TEMPLATE_FIELD_VALUES.has(value as never),
        `Missing field value: ${value}`
      );
    }
  });

  it("does NOT contain any old/wrong field values", () => {
    const oldFields = [
      "styleDNA", "moodMatch", "emotionalEffect", "occasion",
      "bodyPreferences", "colourDirection", "coverage", "visualWeight",
      "statementLevel", "pairingBehavior", "outfitCompleteness",
    ];
    for (const old of oldFields) {
      assert.ok(
        !ALL_PRODUCT_TEMPLATE_FIELD_VALUES.has(old as never),
        `Old field still present: ${old}`
      );
    }
  });

  it("has the Gate 0 intelligence fields", () => {
    assert.equal(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT, "currentEmotionalStateSupport");
    assert.equal(PTF.EMOTIONAL_SUPPORT_LOGIC, "emotionalSupportLogic");
    assert.equal(PTF.PRACTICAL_SUPPORT_MATCH, "practicalSupportMatch");
    assert.equal(PTF.PRACTICAL_SUPPORT_LOGIC, "practicalSupportLogic");
    assert.equal(PTF.STYLING_EFFORT_LEVEL, "stylingEffortLevel");
  });

  it("has correct key names for renamed fields", () => {
    assert.equal(PTF.COLORS, "colors");
    assert.equal(PTF.DESIRED_FEELING_MATCH, "desiredFeelingMatch");
    assert.equal(PTF.STYLE_ME_COMFORT_MATCH, "styleMeComfortMatch");
    assert.equal(PTF.BODY_PROPORTION_EFFECTS, "bodyProportionEffects");
    assert.equal(PTF.COVERAGE_MODESTY, "coverageModesty");
    assert.equal(PTF.OCCASION_TAGS, "occasionTags");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RECOMMENDATION_BEHAVIOURS — complete set, no EXCLUDE
// ─────────────────────────────────────────────────────────────────────────────

describe("RECOMMENDATION_BEHAVIOURS — structure", () => {
  it("contains all required behaviours", () => {
    const required = [
      "HARD_FILTER", "STRONG_RANK", "SOFT_RANK", "DEPRIORITISE",
      "PAIRING", "EXPLANATION_ONLY", "PROFILE_AMPLIFY", "CONTEXTUAL",
      "NO_RECOMMENDATION_EFFECT",
    ];
    for (const b of required) {
      assert.ok(
        b in B,
        `Missing behaviour: ${b}`
      );
    }
  });

  it("does NOT contain EXCLUDE", () => {
    assert.ok(!("EXCLUDE" in B), "EXCLUDE must not exist — use DEPRIORITISE for ordinary avoidance");
  });

  it("DEPRIORITISE is distinct from HARD_FILTER", () => {
    assert.notEqual(B.DEPRIORITISE, B.HARD_FILTER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CANDIDATE_POOLS and ELIGIBILITY_STATES
// ─────────────────────────────────────────────────────────────────────────────

describe("CANDIDATE_POOLS", () => {
  it("has all three pool values", () => {
    assert.equal(CANDIDATE_POOLS.NAIA_ONLY, "NAIA_ONLY");
    assert.equal(CANDIDATE_POOLS.CLOSET_ONLY, "CLOSET_ONLY");
    assert.equal(CANDIDATE_POOLS.BOTH, "BOTH");
  });
});

describe("ELIGIBILITY_STATES — tri-state", () => {
  it("has all three states", () => {
    assert.equal(ELIGIBILITY_STATES.VERIFIED_ACTIVE, "verified-active");
    assert.equal(ELIGIBILITY_STATES.VERIFIED_INACTIVE, "verified-inactive");
    assert.equal(ELIGIBILITY_STATES.UNVERIFIED, "unverified");
  });

  it("isEligible returns true for verified-active", () => {
    // inject a temporary entry
    const handle = "__test-active__";
    PRODUCT_ELIGIBILITY[handle] = "verified-active";
    assert.ok(isEligible(handle));
    delete PRODUCT_ELIGIBILITY[handle];
  });

  it("isEligible returns false for verified-inactive", () => {
    const handle = "__test-inactive__";
    PRODUCT_ELIGIBILITY[handle] = "verified-inactive";
    assert.ok(!isEligible(handle));
    delete PRODUCT_ELIGIBILITY[handle];
  });

  it("isEligible returns true for unverified", () => {
    assert.ok(isEligible("double-top"));
  });

  it("isEligible returns true for unknown handle (not in registry)", () => {
    assert.ok(isEligible("unknown-handle-xyz"));
  });
});

describe("PRODUCT_ELIGIBILITY — all 11 V7 products unverified", () => {
  const V7_HANDLES = [
    "double-top", "collar-shirt", "cropped-top", "asymmetrical-pants",
    "straight-pants", "suede-skirt", "trench-coat", "kimono-jacket",
    "leather-suede-jacket", "midi-dress", "dress-set",
  ];

  it("has all 11 V7 product handles", () => {
    assert.equal(
      V7_HANDLES.filter((h) => h in PRODUCT_ELIGIBILITY).length,
      11
    );
  });

  it("all 11 products are 'unverified'", () => {
    for (const handle of V7_HANDLES) {
      assert.equal(
        PRODUCT_ELIGIBILITY[handle],
        "unverified",
        `${handle} should be unverified`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SESSION_QUESTIONS — 9 flow steps + 2 anchor keys, locked order
// ─────────────────────────────────────────────────────────────────────────────

describe("SESSION_QUESTIONS — structure and order", () => {
  it("has exactly 11 questions (9 flow steps + 2 anchor keys)", () => {
    assert.equal(SESSION_QUESTIONS.length, 11);
  });

  it("questions are in locked order (flow steps 0–8, anchor keys 9–10)", () => {
    const expectedOrder = [
      SQ.MOOD,
      SQ.DESIRED_FEELING,
      SQ.BODY_NEEDS,
      SQ.COVERAGE_CONDITIONAL,
      SQ.OCCASION,
      SQ.FORMALITY_CONDITIONAL,
      SQ.TODAY_COLOURS,
      SQ.PRACTICAL_PLANNING,
      SQ.SOURCE,
      SQ.NADINE_ANCHOR_HANDLE,
      SQ.CLOSET_ANCHOR_ID,
    ];
    for (let i = 0; i < expectedOrder.length; i++) {
      assert.equal(SESSION_QUESTIONS[i].id, expectedOrder[i]);
    }
  });

  it("MOOD has minSelections=1 and maxSelections=2", () => {
    const mood = SESSION_QUESTIONS.find((q) => q.id === SQ.MOOD);
    assert.ok(mood);
    assert.equal(mood.minSelections, 1);
    assert.equal(mood.maxSelections, 2);
  });

  it("DESIRED_FEELING has maxSelections=2", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.DESIRED_FEELING);
    assert.ok(q);
    assert.equal(q.maxSelections, 2);
  });

  it("BODY_NEEDS has maxSelections=2", () => {
    // Step 2A: "Fit & Feel" group cap, independent of the Practical group's own 2-cap.
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.BODY_NEEDS);
    assert.ok(q);
    assert.equal(q.maxSelections, 2);
  });

  it("TODAY_COLOURS has maxSelections=null (free-form)", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.TODAY_COLOURS);
    assert.ok(q);
    assert.equal(q.maxSelections, null);
  });

  it("PRACTICAL_PLANNING has maxSelections=2", () => {
    // Step 2A: "Practical Today" group cap, independent of the Fit & Feel group's own 2-cap.
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.PRACTICAL_PLANNING);
    assert.ok(q);
    assert.equal(q.maxSelections, 2);
  });

  it("SOURCE has maxSelections=1", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.SOURCE);
    assert.ok(q);
    assert.equal(q.maxSelections, 1);
  });

  it("COVERAGE_CONDITIONAL is marked isConditional", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.COVERAGE_CONDITIONAL);
    assert.ok(q?.isConditional);
  });

  it("FORMALITY_CONDITIONAL is marked isConditional", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.FORMALITY_CONDITIONAL);
    assert.ok(q?.isConditional);
  });

  it("FORMALITY_CONDITIONAL showForOccasions contains required occasions", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.FORMALITY_CONDITIONAL);
    const show = q?.showForOccasions ?? [];
    for (const occ of ["work", "dinner", "date-night", "girls-night", "family", "special-event", "not-sure"]) {
      assert.ok(show.includes(occ), `showForOccasions missing: ${occ}`);
    }
  });

  it("FORMALITY_CONDITIONAL skipForOccasions contains everyday and travel", () => {
    const q = SESSION_QUESTIONS.find((q) => q.id === SQ.FORMALITY_CONDITIONAL);
    const skip = q?.skipForOccasions ?? [];
    assert.ok(skip.includes("everyday"));
    assert.ok(skip.includes("travel"));
  });

  it("SESSION_QUESTION_IDS keys match expected session IDs", () => {
    assert.equal(SQ.MOOD, "sq-mood");
    assert.equal(SQ.TODAY_COLOURS, "sq-today-colours");
    assert.equal(SQ.SOURCE, "sq-source");
    assert.equal(SQ.NADINE_ANCHOR_HANDLE, "sq-nadine-anchor-handle");
    assert.equal(SQ.CLOSET_ANCHOR_ID, "sq-closet-anchor-id");
  });

  it("storage keys match locked session cookie names (styleMeXxx convention)", () => {
    const byId = Object.fromEntries(SESSION_QUESTIONS.map((q) => [q.id, q.storageKey]));
    assert.equal(byId[SQ.MOOD], "styleMeMood");
    assert.equal(byId[SQ.DESIRED_FEELING], "styleMeFeelings");
    assert.equal(byId[SQ.BODY_NEEDS], "styleMeBodyNeeds");
    assert.equal(byId[SQ.COVERAGE_CONDITIONAL], "styleMeCoverageConditional");
    assert.equal(byId[SQ.OCCASION], "styleMeOccasion");
    assert.equal(byId[SQ.FORMALITY_CONDITIONAL], "styleMeFormalityConditional");
    assert.equal(byId[SQ.TODAY_COLOURS], "styleMeTodayColours");
    assert.equal(byId[SQ.PRACTICAL_PLANNING], "styleMePractical");
    assert.equal(byId[SQ.SOURCE], "styleMeSource");
    assert.equal(byId[SQ.NADINE_ANCHOR_HANDLE], "styleMeNadineAnchorHandle");
    assert.equal(byId[SQ.CLOSET_ANCHOR_ID], "styleMeClosetAnchorId");
  });

  it("NADINE_ANCHOR_HANDLE and CLOSET_ANCHOR_ID are marked isConditional", () => {
    const nadineQ = SESSION_QUESTIONS.find((q) => q.id === SQ.NADINE_ANCHOR_HANDLE);
    const closetQ = SESSION_QUESTIONS.find((q) => q.id === SQ.CLOSET_ANCHOR_ID);
    assert.ok(nadineQ?.isConditional, "NADINE_ANCHOR_HANDLE must be isConditional");
    assert.ok(closetQ?.isConditional, "CLOSET_ANCHOR_ID must be isConditional");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PROFILE_QUESTIONS — practical-needs not yet in live schema
// ─────────────────────────────────────────────────────────────────────────────

describe("PROFILE_QUESTIONS — structure", () => {
  it("practical-needs question has exists=false", () => {
    const pn = PROFILE_QUESTIONS.find((q) => q.id === PQ.PRACTICAL_NEEDS);
    assert.ok(pn, "practical-needs question not found in PROFILE_QUESTIONS");
    assert.equal(pn.exists, false);
    assert.equal(pn.rankingWeight, "active");
  });

  it("PRACTICAL_NEEDS ID is 'practical-needs'", () => {
    assert.equal(PQ.PRACTICAL_NEEDS, "practical-needs");
  });

  it("analytics-only questions have rankingWeight 'none'", () => {
    const analyticsIds = [PQ.BECOMING, PQ.WARDROBE_DISCONNECTION, PQ.STYLE_SUPPORT];
    for (const id of analyticsIds) {
      const q = PROFILE_QUESTIONS.find((q) => q.id === id);
      assert.ok(q, `Missing: ${id}`);
      assert.equal(q.rankingWeight, "none", `${id} should be analytics-only`);
    }
  });

  it("fit-preferences exists=true", () => {
    const q = PROFILE_QUESTIONS.find((q) => q.id === PQ.FIT_PREFERENCES);
    assert.ok(q?.exists);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. BPE_ALIAS_MAP
// ─────────────────────────────────────────────────────────────────────────────

describe("BPE_ALIAS_MAP", () => {
  it("waist-definition maps to defines-waist and emphasises-waist", () => {
    const canonical = BPE_ALIAS_MAP["waist-definition"];
    assert.ok(canonical.includes("defines-waist"));
    assert.ok(canonical.includes("emphasises-waist"));
  });

  it("elongates maps to four elongation canonical IDs", () => {
    const canonical = BPE_ALIAS_MAP["elongates"];
    assert.ok(canonical.includes("elongates-legs"));
    assert.ok(canonical.includes("elongates-torso"));
    assert.ok(canonical.includes("elongates-body"));
    assert.ok(canonical.includes("creates-vertical-line"));
  });

  it("balances maps to balances-shoulders-and-hips", () => {
    const canonical = BPE_ALIAS_MAP["balances"];
    assert.ok(canonical.includes("balances-shoulders-and-hips"));
  });

  it("direct aliases resolve to themselves", () => {
    assert.deepEqual(BPE_ALIAS_MAP["defines-waist"], ["defines-waist"]);
    assert.deepEqual(BPE_ALIAS_MAP["elongates-legs"], ["elongates-legs"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6b. BODY_NEED_NORMALIZATION_MAP
// ─────────────────────────────────────────────────────────────────────────────

describe("BODY_NEED_NORMALIZATION_MAP", () => {
  it("bloated normalises to soft-and-forgiving-around-waist", () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["bloated"], "soft-and-forgiving-around-waist");
  });

  it("normalised target is a canonical Body Need", () => {
    assert.ok(getMappingsByIdAndQuestion("soft-and-forgiving-around-waist", SQ.BODY_NEEDS));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. PROFILE_DESIRED_FEELING_TRANSLATION
// ─────────────────────────────────────────────────────────────────────────────

describe("PROFILE_DESIRED_FEELING_TRANSLATION", () => {
  it("comfortable → relaxed (Body Need path, NOT DFM)", () => {
    assert.equal(PROFILE_DESIRED_FEELING_TRANSLATION["comfortable"], "relaxed");
  });

  it("elegant → more-elevated (canonical DFM value)", () => {
    assert.equal(PROFILE_DESIRED_FEELING_TRANSLATION["elegant"], "more-elevated");
  });

  it("confident → more-confident", () => {
    assert.equal(PROFILE_DESIRED_FEELING_TRANSLATION["confident"], "more-confident");
  });

  it("put-together → more-put-together", () => {
    assert.equal(PROFILE_DESIRED_FEELING_TRANSLATION["put-together"], "more-put-together");
  });

  it("resolveAlias passes through unknown IDs unchanged", () => {
    assert.equal(resolveAlias("unknown-id-xyz"), "unknown-id-xyz");
  });

  it("resolveAlias applies translation for comfortable", () => {
    assert.equal(resolveAlias("comfortable"), "relaxed");
  });

  it("resolveAlias applies translation for elegant", () => {
    assert.equal(resolveAlias("elegant"), "more-elevated");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Styling Effort Rule
// ─────────────────────────────────────────────────────────────────────────────

describe("STYLING_EFFORT_RULE", () => {
  it("is NOT a hard exclusion", () => {
    assert.equal(STYLING_EFFORT_RULE.isHardExclusion, false);
  });

  it("cannot override a strong match", () => {
    assert.equal(STYLING_EFFORT_RULE.canOverrideStrongMatch, false);
  });

  it("activation moods are tired, low-energy, feeling-low, overwhelmed", () => {
    const moods = [...STYLING_EFFORT_RULE.activationMoods];
    assert.ok(moods.includes("tired"));
    assert.ok(moods.includes("low-energy"));
    assert.ok(moods.includes("feeling-low"));
    assert.ok(moods.includes("overwhelmed"));
    assert.equal(moods.length, 4);
  });

  it("target field is stylingEffortLevel", () => {
    assert.equal(STYLING_EFFORT_RULE.targetField, "stylingEffortLevel");
  });

  it("getStylingEffortActivationMoods returns same set", () => {
    const moods = getStylingEffortActivationMoods();
    assert.ok(moods.includes("tired"));
    assert.ok(moods.includes("overwhelmed"));
  });

  it("self-conscious is NOT an activation mood", () => {
    assert.ok(!getStylingEffortActivationMoods().includes("self-conscious"));
  });

  it("neutral is NOT an activation mood", () => {
    assert.ok(!getStylingEffortActivationMoods().includes("neutral"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. DUAL_MOOD_BONUS
// ─────────────────────────────────────────────────────────────────────────────

describe("DUAL_MOOD_BONUS", () => {
  it("requiresBothMoodsMatch is true", () => {
    assert.equal(DUAL_MOOD_BONUS.requiresBothMoodsMatch, true);
  });

  it("isCapped is true", () => {
    assert.equal(DUAL_MOOD_BONUS.isCapped, true);
  });

  it("targets currentEmotionalStateSupport", () => {
    assert.equal(DUAL_MOOD_BONUS.targetField, "currentEmotionalStateSupport");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Session: Mood answers
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Mood — answer behaviours", () => {
  // Locked canonical mood vocabulary (all 12).
  const CANONICAL_MOOD_IDS = [
    "confident", "tired", "low-energy", "feeling-low", "overwhelmed",
    "adventurous", "romantic", "powerful", "need-reset", "feel-good",
    "self-conscious", "neutral",
  ];

  it("canonical mood vocabulary contains exactly 12 IDs", () => {
    const moodAnswers = getAnswersByQuestion(SQ.MOOD);
    assert.equal(moodAnswers.length, CANONICAL_MOOD_IDS.length);
    for (const id of CANONICAL_MOOD_IDS) {
      assert.ok(moodAnswers.some((m) => m.id === id), `Missing mood: ${id}`);
    }
  });

  it("energised is NOT a canonical mood ID", () => {
    assert.equal(getMappingsByIdAndQuestion("energised", SQ.MOOD), undefined);
  });

  it("bloated is NOT a canonical mood ID", () => {
    assert.equal(getMappingsByIdAndQuestion("bloated", SQ.MOOD), undefined);
  });

  // All rankable moods (everything except self-conscious and neutral).
  const rankableMoods = [
    "confident", "adventurous", "romantic", "powerful", "need-reset", "feel-good",
    "tired", "low-energy", "feeling-low", "overwhelmed",
  ];

  for (const mood of rankableMoods) {
    it(`${mood} → STRONG_RANK against currentEmotionalStateSupport`, () => {
      const m = getMappingsByIdAndQuestion(mood, SQ.MOOD);
      assert.ok(m, `No mapping for mood: ${mood}`);
      assert.ok(m.behaviours.includes(B.STRONG_RANK));
      assert.ok(m.activatedFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
    });
  }

  it("tired activates stylingEffortLevel (Styling Effort Rule)", () => {
    const m = getMappingsByIdAndQuestion("tired", SQ.MOOD);
    assert.ok(m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("low-energy activates stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("low-energy", SQ.MOOD);
    assert.ok(m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("feeling-low activates stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("feeling-low", SQ.MOOD);
    assert.ok(m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("overwhelmed activates stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("overwhelmed", SQ.MOOD);
    assert.ok(m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("confident does NOT activate stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("confident", SQ.MOOD);
    assert.ok(!m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("adventurous does NOT activate stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("adventurous", SQ.MOOD);
    assert.ok(!m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("romantic does NOT activate stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("romantic", SQ.MOOD);
    assert.ok(!m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("powerful (mood) does NOT activate stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("powerful", SQ.MOOD);
    assert.ok(!m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("need-reset does NOT activate stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("need-reset", SQ.MOOD);
    assert.ok(!m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("feel-good does NOT activate stylingEffortLevel", () => {
    const m = getMappingsByIdAndQuestion("feel-good", SQ.MOOD);
    assert.ok(!m?.activatedFields.includes(PTF.STYLING_EFFORT_LEVEL));
  });

  it("romantic (mood) is disambiguated from romantic (Style Personality)", () => {
    const moodEntry = getMappingsByIdAndQuestion("romantic", SQ.MOOD);
    const profileEntry = getMappingsByIdAndQuestion("romantic", PQ.STYLE_PERSONALITIES);
    assert.ok(moodEntry?.activatedFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
    assert.ok(profileEntry?.activatedFields.includes(PTF.STYLE_PERSONALITY_MATCH));
    assert.ok(!moodEntry?.activatedFields.includes(PTF.STYLE_PERSONALITY_MATCH));
    assert.ok(!profileEntry?.activatedFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
  });

  it("powerful (mood) is disambiguated from powerful (Profile Desired Feeling)", () => {
    const moodEntry = getMappingsByIdAndQuestion("powerful", SQ.MOOD);
    const profileEntry = getMappingsByIdAndQuestion("powerful", PQ.DESIRED_FEELINGS);
    assert.ok(moodEntry?.activatedFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
    assert.ok(profileEntry?.activatedFields.includes(PTF.DESIRED_FEELING_MATCH));
    assert.ok(!moodEntry?.activatedFields.includes(PTF.DESIRED_FEELING_MATCH));
    assert.ok(!profileEntry?.activatedFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
  });

  it("self-conscious → CONTEXTUAL, no activated fields, rankingWeight none", () => {
    const m = getMappingsByIdAndQuestion("self-conscious", SQ.MOOD);
    assert.ok(m, "No mapping for self-conscious");
    assert.ok(m.behaviours.includes(B.CONTEXTUAL));
    assert.equal(m.activatedFields.length, 0);
    assert.equal(m.rankingWeight, "none");
  });

  it("self-conscious does NOT generate STRONG_RANK", () => {
    const m = getMappingsByIdAndQuestion("self-conscious", SQ.MOOD);
    assert.ok(!m?.behaviours.includes(B.STRONG_RANK));
  });

  it("self-conscious does NOT activate SMCM (no Body Need inference)", () => {
    const m = getMappingsByIdAndQuestion("self-conscious", SQ.MOOD);
    assert.ok(!m?.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
  });

  it("neutral → NO_RECOMMENDATION_EFFECT, no activated fields, rankingWeight none", () => {
    const m = getMappingsByIdAndQuestion("neutral", SQ.MOOD);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.NO_RECOMMENDATION_EFFECT));
    assert.equal(m.activatedFields.length, 0);
    assert.equal(m.rankingWeight, "none");
  });

  it("mood answers do NOT generate HARD_FILTER", () => {
    const moodAnswers = getAnswersByQuestion(SQ.MOOD);
    for (const m of moodAnswers) {
      assert.ok(
        !m.behaviours.includes(B.HARD_FILTER),
        `${m.id} must not HARD_FILTER`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Session: Desired Feeling
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Desired Feeling — answer behaviours", () => {
  // Locked canonical Desired Feeling vocabulary (all 9).
  const CANONICAL_DF_IDS = [
    "more-confident", "more-put-together", "softer", "more-powerful",
    "more-feminine", "more-effortless", "more-elevated", "more-attractive",
    "like-myself",
  ];

  it("canonical desired feeling vocabulary contains exactly 9 IDs", () => {
    const dfAnswers = getAnswersByQuestion(SQ.DESIRED_FEELING);
    assert.equal(dfAnswers.length, CANONICAL_DF_IDS.length);
    for (const id of CANONICAL_DF_IDS) {
      assert.ok(dfAnswers.some((m) => m.id === id), `Missing desired feeling: ${id}`);
    }
  });

  it("nothing-specific is NOT a session Desired Feeling", () => {
    assert.equal(getMappingsByIdAndQuestion("nothing-specific", SQ.DESIRED_FEELING), undefined);
  });

  const strongRankDF = [
    "more-confident", "more-put-together", "more-elevated", "more-feminine",
    "more-powerful", "more-effortless", "more-attractive",
  ];

  for (const id of strongRankDF) {
    it(`${id} → STRONG_RANK against desiredFeelingMatch`, () => {
      const m = getMappingsByIdAndQuestion(id, SQ.DESIRED_FEELING);
      assert.ok(m, `No mapping for ${id}`);
      assert.ok(m.behaviours.includes(B.STRONG_RANK));
      assert.ok(m.activatedFields.includes(PTF.DESIRED_FEELING_MATCH));
      assert.equal(m.rankingWeight, "active");
    });
  }

  it("softer → STRONG_RANK against desiredFeelingMatch (Step 2A: real signal, not explanation-only)", () => {
    // No catalog product carries "softer" in desiredFeelingMatch yet — catalog
    // retagging is a separate controlled step — but the mapping mechanism itself
    // is now a genuine DFM signal, same as every other Feeling option.
    const m = getMappingsByIdAndQuestion("softer", SQ.DESIRED_FEELING);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.DESIRED_FEELING_MATCH));
    assert.ok(!m.behaviours.includes(B.EXPLANATION_ONLY));
    assert.ok(!m.behaviours.includes(B.PAIRING));
    assert.ok(!m.behaviours.includes(B.HARD_FILTER));
  });

  it("like-myself (session DF) → PROFILE_AMPLIFY, rankingWeight none, no activated fields", () => {
    const m = getMappingsByIdAndQuestion("like-myself", SQ.DESIRED_FEELING);
    assert.ok(m, "like-myself must be registered under SQ.DESIRED_FEELING");
    assert.ok(m.behaviours.includes(B.PROFILE_AMPLIFY));
    assert.equal(m.rankingWeight, "none");
    assert.equal(m.activatedFields.length, 0);
    assert.ok(!m.behaviours.includes(B.STRONG_RANK));
    assert.ok(!m.behaviours.includes(B.SOFT_RANK));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Session: Body Needs
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Body Needs — answer behaviours", () => {
  // Locked canonical Body Need vocabulary (all 9).
  const CANONICAL_BN_IDS = [
    "waist-definition", "soft-and-forgiving-around-waist", "relaxed",
    "more-coverage", "structured", "elongates", "balances",
    "comfortable-elevated", "nothing-specific",
  ];

  it("canonical body need vocabulary contains exactly 9 IDs", () => {
    const bnAnswers = getAnswersByQuestion(SQ.BODY_NEEDS);
    assert.equal(bnAnswers.length, CANONICAL_BN_IDS.length);
    for (const id of CANONICAL_BN_IDS) {
      assert.ok(bnAnswers.some((m) => m.id === id), `Missing body need: ${id}`);
    }
  });

  it("defines-waist is NOT a canonical Body Need session ID", () => {
    assert.equal(getMappingsByIdAndQuestion("defines-waist", SQ.BODY_NEEDS), undefined);
  });

  it("flowy is NOT a canonical Body Need", () => {
    assert.equal(getMappingsByIdAndQuestion("flowy", SQ.BODY_NEEDS), undefined);
  });

  it("movement-friendly is NOT a Body Need (it belongs to Practical Planning)", () => {
    assert.equal(getMappingsByIdAndQuestion("movement-friendly", SQ.BODY_NEEDS), undefined);
  });

  it("waist-definition → STRONG_RANK, activates SMCM + BPE", () => {
    const m = getMappingsByIdAndQuestion("waist-definition", SQ.BODY_NEEDS);
    assert.ok(m, "waist-definition must be registered under SQ.BODY_NEEDS");
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.ok(m.activatedFields.includes(PTF.BODY_PROPORTION_EFFECTS));
    assert.ok(!m.activatedFields.includes(PTF.SILHOUETTE));
    assert.ok(!m.activatedFields.includes(PTF.FIT));
  });

  it("soft-and-forgiving-around-waist → STRONG_RANK against SMCM", () => {
    const m = getMappingsByIdAndQuestion("soft-and-forgiving-around-waist", SQ.BODY_NEEDS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.equal(m.rankingWeight, "active");
  });

  it("structured (Body Need) → STRONG_RANK against SMCM", () => {
    const m = getMappingsByIdAndQuestion("structured", SQ.BODY_NEEDS);
    assert.ok(m, "structured must be registered under SQ.BODY_NEEDS");
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.equal(m.rankingWeight, "active");
  });

  it("structured (Body Need) is disambiguated from structured (Fit Preference)", () => {
    const bnEntry = getMappingsByIdAndQuestion("structured", SQ.BODY_NEEDS);
    const fpEntry = getMappingsByIdAndQuestion("structured", PQ.FIT_PREFERENCES);
    assert.ok(bnEntry?.behaviours.includes(B.STRONG_RANK));
    assert.ok(fpEntry?.behaviours.includes(B.SOFT_RANK));
  });

  it("comfortable-elevated → STRONG_RANK against SMCM", () => {
    const m = getMappingsByIdAndQuestion("comfortable-elevated", SQ.BODY_NEEDS);
    assert.ok(m, "comfortable-elevated must be registered under SQ.BODY_NEEDS");
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.equal(m.rankingWeight, "active");
  });

  it("more-coverage → STRONG_RANK, activates SMCM + COVERAGE_MODESTY", () => {
    const m = getMappingsByIdAndQuestion("more-coverage", SQ.BODY_NEEDS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.ok(m.activatedFields.includes(PTF.COVERAGE_MODESTY));
  });

  it("elongates → STRONG_RANK, activates SMCM + BPE", () => {
    const m = getMappingsByIdAndQuestion("elongates", SQ.BODY_NEEDS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.ok(m.activatedFields.includes(PTF.BODY_PROPORTION_EFFECTS));
  });

  it("balances → STRONG_RANK, activates SMCM + BPE", () => {
    const m = getMappingsByIdAndQuestion("balances", SQ.BODY_NEEDS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.BODY_PROPORTION_EFFECTS));
  });

  it("relaxed → STRONG_RANK against SMCM", () => {
    const m = getMappingsByIdAndQuestion("relaxed", SQ.BODY_NEEDS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
  });

  it("Body Needs answers do NOT generate HARD_FILTER or exclusion", () => {
    const bodyNeedAnswers = getAnswersByQuestion(SQ.BODY_NEEDS);
    for (const m of bodyNeedAnswers) {
      assert.ok(!m.behaviours.includes(B.HARD_FILTER), `${m.id} must not HARD_FILTER`);
    }
  });

  it("nothing-specific (Body Needs) → NO_RECOMMENDATION_EFFECT, no fields", () => {
    const m = getMappingsByIdAndQuestion("nothing-specific", SQ.BODY_NEEDS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.NO_RECOMMENDATION_EFFECT));
    assert.equal(m.activatedFields.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Session: Coverage Conditional
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Coverage Conditional", () => {
  it("coverage-non-negotiable has coverageNonNegotiable=true", () => {
    const m = getMappingsByIdAndQuestion("coverage-non-negotiable", SQ.COVERAGE_CONDITIONAL);
    assert.ok(m);
    assert.equal(m.coverageNonNegotiable, true);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
  });

  it("coverage-flexible-with-layering has coverageNonNegotiable=false", () => {
    const m = getMappingsByIdAndQuestion("coverage-flexible-with-layering", SQ.COVERAGE_CONDITIONAL);
    assert.ok(m);
    assert.equal(m.coverageNonNegotiable, false);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
  });

  it("isCoverageNonNegotiable works", () => {
    assert.ok(isCoverageNonNegotiable("coverage-non-negotiable"));
    assert.ok(!isCoverageNonNegotiable("coverage-flexible-with-layering"));
    assert.ok(!isCoverageNonNegotiable("unknown-id"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Session: Occasion
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Occasion — answer behaviours", () => {
  const contentOccasions = [
    "work", "everyday", "dinner", "date-night", "girls-night",
    "family", "special-event", "travel",
  ];

  for (const occ of contentOccasions) {
    it(`${occ} → STRONG_RANK against occasionTags`, () => {
      const m = getMappingsByIdAndQuestion(occ, SQ.OCCASION);
      assert.ok(m, `No mapping for ${occ}`);
      assert.ok(m.behaviours.includes(B.STRONG_RANK));
      assert.ok(m.activatedFields.includes(PTF.OCCASION_TAGS));
    });
  }

  it("not-sure → NO_RECOMMENDATION_EFFECT, no activated fields", () => {
    const m = getMappingsByIdAndQuestion("not-sure", SQ.OCCASION);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.NO_RECOMMENDATION_EFFECT));
    assert.equal(m.activatedFields.length, 0);
  });

  it("occasion answers do NOT use HARD_FILTER", () => {
    const occasionAnswers = getAnswersByQuestion(SQ.OCCASION);
    for (const m of occasionAnswers) {
      assert.ok(!m.behaviours.includes(B.HARD_FILTER), `${m.id} must not HARD_FILTER`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Session: Formality Conditional
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Formality Conditional", () => {
  const formalityAnswers = [
    "formality-relaxed", "formality-smart", "formality-polished", "formality-occasion",
  ];

  it("has exactly 4 formality conditional answers", () => {
    const answers = getAnswersByQuestion(SQ.FORMALITY_CONDITIONAL);
    assert.equal(answers.length, 4);
  });

  for (const id of formalityAnswers) {
    it(`${id} → STRONG_RANK against formalityScore (not HARD_FILTER)`, () => {
      const m = getMappingsByIdAndQuestion(id, SQ.FORMALITY_CONDITIONAL);
      assert.ok(m, `No mapping for ${id}`);
      assert.ok(m.behaviours.includes(B.STRONG_RANK));
      assert.ok(!m.behaviours.includes(B.HARD_FILTER));
      assert.ok(m.activatedFields.includes(PTF.FORMALITY_SCORE));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Session: Today Colours
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Today Colours", () => {
  it("colour-preferred-today → STRONG_RANK against colors", () => {
    const m = getMappingsByIdAndQuestion("colour-preferred-today", SQ.TODAY_COLOURS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.COLORS));
  });

  it("colour-avoid-today → DEPRIORITISE against colors (NOT HARD_FILTER or EXCLUDE)", () => {
    const m = getMappingsByIdAndQuestion("colour-avoid-today", SQ.TODAY_COLOURS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.DEPRIORITISE));
    assert.ok(!m.behaviours.includes(B.HARD_FILTER));
    assert.ok(!m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.COLORS));
  });

  it("no-special-constraint → NO_RECOMMENDATION_EFFECT", () => {
    const m = getMappingsByIdAndQuestion("no-special-constraint", SQ.TODAY_COLOURS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.NO_RECOMMENDATION_EFFECT));
  });

  it("getSessionOverrideCategory identifies today-colours", () => {
    assert.equal(getSessionOverrideCategory("colour-preferred-today"), "today-colours");
    assert.equal(getSessionOverrideCategory("colour-avoid-today"), "today-colours");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Session: Practical Planning
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Practical Planning", () => {
  const planningAnswers = ["quick-to-style", "long-day", "day-to-night"];

  for (const id of planningAnswers) {
    it(`${id} → STRONG_RANK against practicalSupportMatch`, () => {
      const m = getMappingsByIdAndQuestion(id, SQ.PRACTICAL_PLANNING);
      assert.ok(m, `No mapping for ${id}`);
      assert.ok(m.behaviours.includes(B.STRONG_RANK));
      assert.ok(m.activatedFields.includes(PTF.PRACTICAL_SUPPORT_MATCH));
    });
  }

  it("movement-friendly (Practical Planning) activates PSM, not SMCM", () => {
    const m = getMappingsByIdAndQuestion("movement-friendly", SQ.PRACTICAL_PLANNING);
    assert.ok(m);
    assert.ok(m.activatedFields.includes(PTF.PRACTICAL_SUPPORT_MATCH));
    assert.ok(!m.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
  });

  it("movement-friendly exists ONLY under PRACTICAL_PLANNING, NOT under BODY_NEEDS", () => {
    assert.ok(getMappingsByIdAndQuestion("movement-friendly", SQ.PRACTICAL_PLANNING));
    assert.equal(getMappingsByIdAndQuestion("movement-friendly", SQ.BODY_NEEDS), undefined);
  });

  it("nothing-specific (Practical Planning) → NO_RECOMMENDATION_EFFECT", () => {
    const m = getMappingsByIdAndQuestion("nothing-specific", SQ.PRACTICAL_PLANNING);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.NO_RECOMMENDATION_EFFECT));
  });

  it("practical-footwear is a canonical direct session-match value", () => {
    const m = getMappingsByIdAndQuestion("practical-footwear", SQ.PRACTICAL_PLANNING);
    assert.ok(m, "practical-footwear missing from ANSWER_REGISTRY");
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.PRACTICAL_SUPPORT_MATCH));
  });

  it("hot-outdoors → STRONG_RANK against practicalSupportMatch", () => {
    const m = getMappingsByIdAndQuestion("hot-outdoors", SQ.PRACTICAL_PLANNING);
    assert.ok(m, "hot-outdoors missing from ANSWER_REGISTRY");
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.PRACTICAL_SUPPORT_MATCH));
  });

  it("cool-air-conditioning → STRONG_RANK against practicalSupportMatch", () => {
    const m = getMappingsByIdAndQuestion("cool-air-conditioning", SQ.PRACTICAL_PLANNING);
    assert.ok(m, "cool-air-conditioning missing from ANSWER_REGISTRY");
    assert.ok(m.behaviours.includes(B.STRONG_RANK));
    assert.ok(m.activatedFields.includes(PTF.PRACTICAL_SUPPORT_MATCH));
  });

  it("PSM_SUPPLEMENTAL_PRODUCT_TOKENS contains exactly adaptable, easy-layering, higher-effort-statement", () => {
    assert.equal(PSM_SUPPLEMENTAL_PRODUCT_TOKENS.size, 3);
    for (const t of ["adaptable", "easy-layering", "higher-effort-statement"]) {
      assert.ok(PSM_SUPPLEMENTAL_PRODUCT_TOKENS.has(t), `Missing from supplemental set: ${t}`);
    }
  });

  it("supplemental PSM tokens are NOT direct session-match (not in ANSWER_REGISTRY under PRACTICAL_PLANNING)", () => {
    for (const t of PSM_SUPPLEMENTAL_PRODUCT_TOKENS) {
      assert.equal(
        getMappingsByIdAndQuestion(t, SQ.PRACTICAL_PLANNING),
        undefined,
        `${t} must not be a direct session match`,
      );
    }
  });

  it("PSM_NORMALIZATION_MAP: lots-of-movement normalizes to movement-friendly", () => {
    assert.equal(PSM_NORMALIZATION_MAP["lots-of-movement"], "movement-friendly");
  });

  it("unknown practical token is not in ANSWER_REGISTRY and not in supplemental set", () => {
    assert.equal(getMappingsByIdAndQuestion("fancy-gala", SQ.PRACTICAL_PLANNING), undefined);
    assert.ok(!PSM_SUPPLEMENTAL_PRODUCT_TOKENS.has("fancy-gala"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Session: Source
// ─────────────────────────────────────────────────────────────────────────────

describe("Session Source — pool constraint, not product-field score", () => {
  it("naia-piece → NAIA_ONLY pool, no behaviours, rankingWeight none", () => {
    const m = getMappingsByIdAndQuestion("naia-piece", SQ.SOURCE);
    assert.ok(m);
    assert.equal(m.candidatePool, CANDIDATE_POOLS.NAIA_ONLY);
    assert.equal(m.behaviours.length, 0);
    assert.equal(m.activatedFields.length, 0);
    assert.equal(m.rankingWeight, "none");
  });

  it("my-closet → CLOSET_ONLY pool", () => {
    const m = getMappingsByIdAndQuestion("my-closet", SQ.SOURCE);
    assert.ok(m);
    assert.equal(m.candidatePool, CANDIDATE_POOLS.CLOSET_ONLY);
  });

  it("both → BOTH pool", () => {
    const m = getMappingsByIdAndQuestion("both", SQ.SOURCE);
    assert.ok(m);
    assert.equal(m.candidatePool, CANDIDATE_POOLS.BOTH);
  });

  it("source answers do NOT generate HARD_FILTER", () => {
    const sourceAnswers = getAnswersByQuestion(SQ.SOURCE);
    for (const m of sourceAnswers) {
      assert.ok(!m.behaviours.includes(B.HARD_FILTER), `${m.id} must not HARD_FILTER`);
    }
  });

  it("getCandidatePool returns correct pools", () => {
    assert.equal(getCandidatePool("naia-piece"), CANDIDATE_POOLS.NAIA_ONLY);
    assert.equal(getCandidatePool("my-closet"), CANDIDATE_POOLS.CLOSET_ONLY);
    assert.equal(getCandidatePool("both"), CANDIDATE_POOLS.BOTH);
    assert.equal(getCandidatePool("confident"), null);
    assert.equal(getCandidatePool("unknown-xyz"), null);
  });

  it("getSessionOverrideCategory identifies source answers", () => {
    assert.equal(getSessionOverrideCategory("naia-piece"), "source");
    assert.equal(getSessionOverrideCategory("my-closet"), "source");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18.5. Profile: Style Personalities — approved 10-ID vocabulary
// ─────────────────────────────────────────────────────────────────────────────

describe("Profile Style Personalities — approved 10-ID vocabulary", () => {
  const APPROVED_SP_IDS = [
    "old-money", "artsy", "edgy", "feminine", "corporate-chic",
    "effortlessly-chic", "minimal", "trendy", "romantic", "casual-cool",
  ];
  const STALE_SP_IDS = [
    "bold", "minimalist", "classic", "eclectic", "bohemian", "preppy", "artistic",
  ];
  const STYLE_TAG_FALLBACK_IDS = ["old-money", "minimal", "casual-cool"];

  it("exactly 10 style personality answer IDs registered", () => {
    const sp = getAnswersByQuestion(PQ.STYLE_PERSONALITIES);
    const ids = sp.map((m) => m.id).sort();
    assert.equal(sp.length, 10, `Expected 10, got ${sp.length}: ${ids.join(", ")}`);
    assert.deepEqual(ids, [...APPROVED_SP_IDS].sort());
  });

  for (const id of APPROVED_SP_IDS) {
    it(`${id} → SOFT_RANK against stylePersonalityMatch (Step 2A: demoted from STRONG_RANK)`, () => {
      // Declarative tier matches every other Passport background signal in this
      // file (Fit Preferences, Desired Feelings, Lifestyle, Desired Impression
      // all use SOFT_RANK here). Engine-side numeric weight is SCORING_WEIGHTS.RANK
      // — see styleme-recommendation.ts §7. Passport background preferences must
      // not outweigh today's explicit session-specific StyleMe answers.
      const m = getMappingsByIdAndQuestion(id, PQ.STYLE_PERSONALITIES);
      assert.ok(m, `Missing mapping: ${id}`);
      assert.ok(m.behaviours.includes(B.SOFT_RANK), `${id} must be SOFT_RANK`);
      assert.ok(!m.behaviours.includes(B.STRONG_RANK), `${id} must NOT be STRONG_RANK`);
      assert.ok(m.activatedFields.includes(PTF.STYLE_PERSONALITY_MATCH), `${id} must activate STYLE_PERSONALITY_MATCH`);
    });
  }

  for (const id of STALE_SP_IDS) {
    it(`stale ID "${id}" is NOT registered under STYLE_PERSONALITIES`, () => {
      assert.equal(
        getMappingsByIdAndQuestion(id, PQ.STYLE_PERSONALITIES),
        undefined,
        `Stale ID still present: ${id}`,
      );
    });
  }

  it("STYLE_PERSONALITY_STYLE_TAG_FALLBACK contains exactly the 3 fallback IDs", () => {
    assert.equal(STYLE_PERSONALITY_STYLE_TAG_FALLBACK.size, 3);
    for (const id of STYLE_TAG_FALLBACK_IDS) {
      assert.ok(STYLE_PERSONALITY_STYLE_TAG_FALLBACK.has(id), `${id} missing from fallback set`);
    }
  });

  it("non-fallback approved IDs are NOT in STYLE_PERSONALITY_STYLE_TAG_FALLBACK", () => {
    for (const id of APPROVED_SP_IDS) {
      if (!STYLE_TAG_FALLBACK_IDS.includes(id)) {
        assert.ok(!STYLE_PERSONALITY_STYLE_TAG_FALLBACK.has(id), `${id} must not be in fallback set`);
      }
    }
  });

  it("romantic (mood) is still correctly disambiguated from romantic (Style Personality)", () => {
    const moodEntry = getMappingsByIdAndQuestion("romantic", SQ.MOOD);
    const profileEntry = getMappingsByIdAndQuestion("romantic", PQ.STYLE_PERSONALITIES);
    assert.ok(moodEntry?.activatedFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
    assert.ok(profileEntry?.activatedFields.includes(PTF.STYLE_PERSONALITY_MATCH));
    assert.ok(!moodEntry?.activatedFields.includes(PTF.STYLE_PERSONALITY_MATCH));
    assert.ok(!profileEntry?.activatedFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Profile: Fit Preferences
// ─────────────────────────────────────────────────────────────────────────────

describe("Profile Fit Preferences — via SMCM/BPE, NOT silhouette/fit", () => {
  const fitPrefIds = [
    "defined-waist", "relaxed-fits", "structured", "oversized",
    "flowy", "coverage", "fitted", "simple",
  ];

  it("has all 8 verified fit preference answer IDs", () => {
    for (const id of fitPrefIds) {
      assert.ok(
        getMappingsByIdAndQuestion(id, PQ.FIT_PREFERENCES),
        `Missing fit pref mapping: ${id}`
      );
    }
  });

  for (const id of fitPrefIds) {
    it(`${id} → SOFT_RANK, does NOT activate silhouette or fit fields`, () => {
      const m = getMappingsByIdAndQuestion(id, PQ.FIT_PREFERENCES);
      assert.ok(m);
      assert.ok(m.behaviours.includes(B.SOFT_RANK));
      assert.ok(!m.activatedFields.includes(PTF.SILHOUETTE), `${id} must not activate silhouette`);
      assert.ok(!m.activatedFields.includes(PTF.FIT), `${id} must not activate fit`);
    });
  }

  it("defined-waist (Fit Pref) activates SMCM + BPE", () => {
    const m = getMappingsByIdAndQuestion("defined-waist", PQ.FIT_PREFERENCES);
    assert.ok(m?.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.ok(m?.activatedFields.includes(PTF.BODY_PROPORTION_EFFECTS));
  });

  it("relaxed-fits activates SMCM only", () => {
    const m = getMappingsByIdAndQuestion("relaxed-fits", PQ.FIT_PREFERENCES);
    assert.ok(m?.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.ok(!m?.activatedFields.includes(PTF.BODY_PROPORTION_EFFECTS));
  });

  it("coverage (Fit Pref) activates SMCM + COVERAGE_MODESTY", () => {
    const m = getMappingsByIdAndQuestion("coverage", PQ.FIT_PREFERENCES);
    assert.ok(m?.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.ok(m?.activatedFields.includes(PTF.COVERAGE_MODESTY));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19b. Profile Silhouette / Coverage — Step 2A background mappings
// Only semantically exact pairs are mapped. Unsupported signals stay unused
// rather than being approximated onto a nearby token.
// ─────────────────────────────────────────────────────────────────────────────

describe("Profile Silhouette — approved mappings only", () => {
  const approved: Array<[string, string]> = [
    ["defined-waist", "waist-definition"],
    ["oversized", "relaxed"],
    ["flowing", "relaxed"],
    ["relaxed", "relaxed"],
  ];

  for (const [id, target] of approved) {
    it(`${id} → ${target}`, () => {
      assert.equal(PROFILE_SILHOUETTE_SMCM_MAP[id], target);
    });
  }

  it("has exactly 4 approved entries", () => {
    assert.equal(Object.keys(PROFILE_SILHOUETTE_SMCM_MAP).length, 4);
  });

  it("does NOT map straight or fitted (no semantically exact target exists)", () => {
    assert.equal(PROFILE_SILHOUETTE_SMCM_MAP["straight"], undefined);
    assert.equal(PROFILE_SILHOUETTE_SMCM_MAP["fitted"], undefined);
  });
});

describe("Profile Coverage — approved background support for more-coverage", () => {
  it("preferredCoverage single-select target is 'mostly-covered'", () => {
    assert.equal(PROFILE_COVERAGE_PREFERRED_VALUE, "mostly-covered");
  });

  it("coveragePreferences multi-select approved IDs are sleeves-preferred and longer-hemlines only", () => {
    assert.equal(PROFILE_COVERAGE_MULTI_IDS.size, 2);
    assert.ok(PROFILE_COVERAGE_MULTI_IDS.has("sleeves-preferred"));
    assert.ok(PROFILE_COVERAGE_MULTI_IDS.has("longer-hemlines"));
  });

  it("does NOT include open-necklines or cropped (no 'less coverage' target exists)", () => {
    assert.ok(!PROFILE_COVERAGE_MULTI_IDS.has("open-necklines"));
    assert.ok(!PROFILE_COVERAGE_MULTI_IDS.has("cropped"));
  });
});

describe("Forbidden approximate Passport mappings — must remain unused", () => {
  it("Trend Appetite has no mapping to 'edgy' or 'trendy' anywhere in the signal contract", () => {
    // Trend Appetite is not wired to any product field in Step 2A — there is no
    // TREND_APPETITE-related export to check a mapping on. This test documents
    // the absence: neither PROFILE_SILHOUETTE_SMCM_MAP nor PROFILE_FIT_PREFERENCE_SMCM_MAP
    // (the only two Passport→SMCM lookup tables) contain "edgy" or universal "trendy"
    // as a value, confirming no approximate style-tag mapping was introduced.
    const silhouetteValues = Object.values(PROFILE_SILHOUETTE_SMCM_MAP);
    assert.ok(!silhouetteValues.includes("edgy"));
    assert.ok(!silhouetteValues.includes("trendy"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Profile: Desired Feelings
// ─────────────────────────────────────────────────────────────────────────────

describe("Profile Desired Feelings", () => {
  const storedIds = [
    "confident", "comfortable", "put-together", "elegant",
    "feminine", "powerful", "effortless", "attractive",
  ];

  it("has all 8 stored desired feeling answer IDs", () => {
    for (const id of storedIds) {
      assert.ok(
        getMappingsByIdAndQuestion(id, PQ.DESIRED_FEELINGS),
        `Missing: ${id}`
      );
    }
  });

  it("all desired feeling profile answers → SOFT_RANK", () => {
    for (const id of storedIds) {
      const m = getMappingsByIdAndQuestion(id, PQ.DESIRED_FEELINGS);
      assert.ok(m?.behaviours.includes(B.SOFT_RANK), `${id} must be SOFT_RANK`);
    }
  });

  it("comfortable routes to SMCM (Body Need path, NOT DFM)", () => {
    const m = getMappingsByIdAndQuestion("comfortable", PQ.DESIRED_FEELINGS);
    assert.ok(m?.activatedFields.includes(PTF.STYLE_ME_COMFORT_MATCH));
    assert.ok(!m?.activatedFields.includes(PTF.DESIRED_FEELING_MATCH));
  });

  it("elegant routes to desiredFeelingMatch (canonical more-elevated)", () => {
    const m = getMappingsByIdAndQuestion("elegant", PQ.DESIRED_FEELINGS);
    assert.ok(m?.activatedFields.includes(PTF.DESIRED_FEELING_MATCH));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. Profile: Colours — avoid vs firm-no
// ─────────────────────────────────────────────────────────────────────────────

describe("Profile Avoid Colours — DEPRIORITISE not EXCLUDE/HARD_FILTER", () => {
  it("profile-colour-avoid → DEPRIORITISE against colors, firmNo=false", () => {
    const m = getMappingsByIdAndQuestion("profile-colour-avoid", PQ.AVOID_COLORS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.DEPRIORITISE));
    assert.ok(!m.behaviours.includes(B.HARD_FILTER));
    assert.equal(m.firmNo, false);
    assert.ok(m.activatedFields.includes(PTF.COLORS));
  });

  it("profile-colour-firm-no → HARD_FILTER, firmNo=true", () => {
    const m = getMappingsByIdAndQuestion("profile-colour-firm-no", PQ.AVOID_COLORS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.HARD_FILTER));
    assert.equal(m.firmNo, true);
    assert.ok(m.activatedFields.includes(PTF.COLORS));
  });

  it("profile-colour-favourite → SOFT_RANK", () => {
    const m = getMappingsByIdAndQuestion("profile-colour-favourite", PQ.FAVORITE_COLORS);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.SOFT_RANK));
    assert.ok(m.activatedFields.includes(PTF.COLORS));
  });

  it("isFirmNo works correctly", () => {
    assert.ok(isFirmNo("profile-colour-firm-no"));
    assert.ok(!isFirmNo("profile-colour-avoid"));
    assert.ok(!isFirmNo("colour-avoid-today"));
    assert.ok(!isFirmNo("unknown-id"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. Profile: like-myself (PROFILE_AMPLIFY)
// ─────────────────────────────────────────────────────────────────────────────

describe("Profile: like-myself → PROFILE_AMPLIFY", () => {
  it("like-myself → PROFILE_AMPLIFY, rankingWeight none, no activated fields", () => {
    const m = getMappingsByIdAndQuestion("like-myself", PQ.STYLE_SUPPORT);
    assert.ok(m);
    assert.ok(m.behaviours.includes(B.PROFILE_AMPLIFY));
    assert.equal(m.rankingWeight, "none");
    assert.equal(m.activatedFields.length, 0);
  });

  it("like-myself does NOT generate STRONG_RANK or SOFT_RANK", () => {
    const m = getMappingsByIdAndQuestion("like-myself", PQ.STYLE_SUPPORT);
    assert.ok(!m?.behaviours.includes(B.STRONG_RANK));
    assert.ok(!m?.behaviours.includes(B.SOFT_RANK));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. Profile: Becoming and Wardrobe Disconnection (analytics only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Profile analytics-only answers", () => {
  const becomingIds = [
    "becoming-alive", "becoming-real", "becoming-fragmented", "becoming-grounded",
    "becoming-unfiltered", "becoming-rooted", "becoming-seen", "becoming-whole",
    "becoming-clear", "becoming-her", "becoming-defined",
  ];

  it("has all 11 becoming answers (one per V7 product)", () => {
    assert.equal(becomingIds.length, 11);
    for (const id of becomingIds) {
      assert.ok(getMappingsByIdAndQuestion(id, PQ.BECOMING), `Missing: ${id}`);
    }
  });

  for (const id of becomingIds) {
    it(`${id} → NO_RECOMMENDATION_EFFECT, rankingWeight none`, () => {
      const m = getMappingsByIdAndQuestion(id, PQ.BECOMING);
      assert.ok(m);
      assert.ok(m.behaviours.includes(B.NO_RECOMMENDATION_EFFECT));
      assert.equal(m.rankingWeight, "none");
      assert.equal(m.activatedFields.length, 0);
    });
  }

  it("wardrobe-disconnection answers → NO_RECOMMENDATION_EFFECT", () => {
    const wdIds = [
      "wardrobe-disconnection-not-me",
      "wardrobe-disconnection-outdated",
      "wardrobe-disconnection-nothing-to-wear",
    ];
    for (const id of wdIds) {
      const m = getMappingsByIdAndQuestion(id, PQ.WARDROBE_DISCONNECTION);
      assert.ok(m);
      assert.ok(m.behaviours.includes(B.NO_RECOMMENDATION_EFFECT));
      assert.equal(m.rankingWeight, "none");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. isNeutralAnswer
// ─────────────────────────────────────────────────────────────────────────────

describe("isNeutralAnswer", () => {
  it("returns true for neutral", () => assert.ok(isNeutralAnswer("neutral")));
  it("returns true for nothing-specific", () => assert.ok(isNeutralAnswer("nothing-specific")));
  it("returns true for no-special-constraint", () => assert.ok(isNeutralAnswer("no-special-constraint")));
  it("returns true for not-sure", () => assert.ok(isNeutralAnswer("not-sure")));
  it("returns false for confident", () => assert.ok(!isNeutralAnswer("confident")));
  it("returns false for tired", () => assert.ok(!isNeutralAnswer("tired")));
  it("returns false for self-conscious", () => assert.ok(!isNeutralAnswer("self-conscious")));
  it("returns false for more-elevated", () => assert.ok(!isNeutralAnswer("more-elevated")));
  it("returns false for unknown ID", () => assert.ok(!isNeutralAnswer("unknown-xyz")));
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. API utility functions
// ─────────────────────────────────────────────────────────────────────────────

describe("API utility functions", () => {
  it("isKnownAnswer returns true for registered IDs", () => {
    assert.ok(isKnownAnswer("confident"));
    assert.ok(isKnownAnswer("tired"));
    assert.ok(isKnownAnswer("more-elevated"));
    assert.ok(isKnownAnswer("softer"));
    assert.ok(isKnownAnswer("naia-piece"));
    assert.ok(isKnownAnswer("like-myself"));
  });

  it("isKnownAnswer returns false for unknown IDs", () => {
    assert.ok(!isKnownAnswer("unknown-xyz"));
    assert.ok(!isKnownAnswer("BECOMING"));
    assert.ok(!isKnownAnswer("moodMatch"));
  });

  it("getMappingById returns a mapping for known IDs", () => {
    assert.ok(getMappingById("confident"));
    assert.ok(getMappingById("tired"));
  });

  it("getMappingById returns undefined for unknown IDs", () => {
    assert.equal(getMappingById("unknown-xyz"), undefined);
  });

  it("getActivatedFields aggregates across all questions for an ID", () => {
    // "confident" appears in SQ.MOOD (ESS) and PQ.DESIRED_FEELINGS (DFM)
    const fields = getActivatedFields("confident");
    assert.ok(fields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
    assert.ok(fields.includes(PTF.DESIRED_FEELING_MATCH));
  });

  it("getActivatedFieldsByQuestion narrows to question scope", () => {
    const moodFields = getActivatedFieldsByQuestion("confident", SQ.MOOD);
    assert.ok(moodFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
    assert.ok(!moodFields.includes(PTF.DESIRED_FEELING_MATCH));

    const profileFields = getActivatedFieldsByQuestion("confident", PQ.DESIRED_FEELINGS);
    assert.ok(profileFields.includes(PTF.DESIRED_FEELING_MATCH));
    assert.ok(!profileFields.includes(PTF.CURRENT_EMOTIONAL_STATE_SUPPORT));
  });

  it("getActivatedFields returns [] for unknown ID", () => {
    assert.deepEqual(getActivatedFields("unknown-xyz"), []);
  });

  it("getBehaviours returns correct behaviours", () => {
    const softerB = getBehaviours("softer");
    assert.ok(softerB.includes(B.STRONG_RANK));
    assert.ok(!softerB.includes(B.EXPLANATION_ONLY));
  });

  it("getBehaviours returns [] for unknown ID", () => {
    assert.deepEqual(getBehaviours("unknown-xyz"), []);
  });

  it("getAnswersByQuestion returns all answers for a question", () => {
    const moodAnswers = getAnswersByQuestion(SQ.MOOD);
    assert.ok(moodAnswers.length >= 9);
    assert.ok(moodAnswers.some((m) => m.id === "tired"));
    assert.ok(moodAnswers.some((m) => m.id === "self-conscious"));
    assert.ok(moodAnswers.some((m) => m.id === "neutral"));
  });

  it("getAnswersByQuestion returns [] for unknown question", () => {
    assert.deepEqual(getAnswersByQuestion("unknown-question-xyz"), []);
  });

  it("getSessionOverrideCategory returns null for profile answers", () => {
    assert.equal(getSessionOverrideCategory("old-money"), null);
    assert.equal(getSessionOverrideCategory("like-myself"), null);
  });

  it("getSessionOverrideCategory returns coverage-conditional", () => {
    assert.equal(getSessionOverrideCategory("coverage-non-negotiable"), "coverage-conditional");
  });

  it("getSessionOverrideCategory returns formality-conditional", () => {
    assert.equal(getSessionOverrideCategory("formality-polished"), "formality-conditional");
  });

  it("isEligible true for all V7 handles (unverified)", () => {
    const handles = [
      "double-top", "collar-shirt", "cropped-top", "asymmetrical-pants",
      "straight-pants", "suede-skirt", "trench-coat", "kimono-jacket",
      "leather-suede-jacket", "midi-dress", "dress-set",
    ];
    for (const h of handles) {
      assert.ok(isEligible(h), `${h} should be eligible`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. PROVISIONAL_EVIDENCE — 17 entries with verified V7 handles
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVISIONAL_EVIDENCE", () => {
  const V7_HANDLES = new Set([
    "double-top", "collar-shirt", "cropped-top", "asymmetrical-pants",
    "straight-pants", "suede-skirt", "trench-coat", "kimono-jacket",
    "leather-suede-jacket", "midi-dress", "dress-set",
  ]);

  it("has exactly 17 entries", () => {
    assert.equal(PROVISIONAL_EVIDENCE.length, 17);
  });

  it("all entries use verified V7 product handles", () => {
    for (const e of PROVISIONAL_EVIDENCE) {
      assert.ok(
        V7_HANDLES.has(e.productHandle),
        `Unknown handle in PROVISIONAL_EVIDENCE: ${e.productHandle}`
      );
    }
  });

  it("all entries have evidenceStatus 'provisional'", () => {
    for (const e of PROVISIONAL_EVIDENCE) {
      assert.equal(e.evidenceStatus, "provisional");
    }
  });

  it("all entries have a provisionalNote", () => {
    for (const e of PROVISIONAL_EVIDENCE) {
      assert.ok(e.provisionalNote && e.provisionalNote.length > 0);
    }
  });

  it("all fields are valid ProductTemplateField values", () => {
    for (const e of PROVISIONAL_EVIDENCE) {
      assert.ok(
        ALL_PRODUCT_TEMPLATE_FIELD_VALUES.has(e.field),
        `Unknown field in PROVISIONAL_EVIDENCE: ${e.field}`
      );
    }
  });

  it("includes midi-dress ESS tired and low-energy", () => {
    const midiEss = PROVISIONAL_EVIDENCE.filter(
      (e) => e.productHandle === "midi-dress" && e.field === PTF.CURRENT_EMOTIONAL_STATE_SUPPORT
    );
    assert.ok(midiEss.some((e) => e.canonicalValue === "tired"));
    assert.ok(midiEss.some((e) => e.canonicalValue === "low-energy"));
  });

  it("includes dress-set stylingEffortLevel high", () => {
    const e = PROVISIONAL_EVIDENCE.find(
      (e) => e.productHandle === "dress-set" && e.field === PTF.STYLING_EFFORT_LEVEL
    );
    assert.ok(e);
    assert.equal(e.canonicalValue, "high");
  });

  it("includes collar-shirt PSM long-day", () => {
    const e = PROVISIONAL_EVIDENCE.find(
      (e) => e.productHandle === "collar-shirt" && e.field === PTF.PRACTICAL_SUPPORT_MATCH
    );
    assert.ok(e);
    assert.equal(e.canonicalValue, "long-day");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27. ANSWER_REGISTRY — structural integrity
// ─────────────────────────────────────────────────────────────────────────────

describe("ANSWER_REGISTRY — structural integrity", () => {
  it("no mapping uses EXCLUDE behaviour", () => {
    for (const m of ANSWER_REGISTRY) {
      assert.ok(
        !(m.behaviours as string[]).includes("EXCLUDE"),
        `${m.id}/${m.questionId} must not use EXCLUDE`
      );
    }
  });

  it("all activatedFields are valid ProductTemplateField values", () => {
    for (const m of ANSWER_REGISTRY) {
      for (const f of m.activatedFields) {
        assert.ok(
          ALL_PRODUCT_TEMPLATE_FIELD_VALUES.has(f),
          `Invalid field "${f}" in mapping ${m.id}/${m.questionId}`
        );
      }
    }
  });

  it("all behaviours are valid Behaviour values", () => {
    const validBehaviours = new Set(Object.values(B));
    for (const m of ANSWER_REGISTRY) {
      for (const beh of m.behaviours) {
        assert.ok(
          validBehaviours.has(beh),
          `Invalid behaviour "${beh}" in mapping ${m.id}/${m.questionId}`
        );
      }
    }
  });

  it("all candidatePool values (when set) are valid", () => {
    const validPools = new Set(Object.values(CANDIDATE_POOLS));
    for (const m of ANSWER_REGISTRY) {
      if (m.candidatePool !== undefined) {
        assert.ok(
          validPools.has(m.candidatePool),
          `Invalid candidatePool "${m.candidatePool}" in ${m.id}`
        );
      }
    }
  });

  it("source answers are the only answers with candidatePool set", () => {
    for (const m of ANSWER_REGISTRY) {
      if (m.candidatePool !== undefined) {
        assert.equal(
          m.questionId,
          SQ.SOURCE,
          `${m.id} has candidatePool but is not a source answer`
        );
      }
    }
  });

  it("rankingWeight is always 'active' or 'none'", () => {
    for (const m of ANSWER_REGISTRY) {
      assert.ok(
        m.rankingWeight === "active" || m.rankingWeight === "none",
        `${m.id}: invalid rankingWeight "${m.rankingWeight}"`
      );
    }
  });

  it("ANSWER_REGISTRY has entries for all 9 flow-step session questions (anchor keys excluded)", () => {
    // The two anchor keys (NADINE_ANCHOR_HANDLE, CLOSET_ANCHOR_ID) store free-form IDs
    // selected by the customer — they have no predefined answer vocabulary.
    const ANCHOR_KEY_IDS = new Set([SQ.NADINE_ANCHOR_HANDLE, SQ.CLOSET_ANCHOR_ID]);
    const sessionQIds = new Set(Object.values(SQ).filter((id) => !ANCHOR_KEY_IDS.has(id)));
    const registeredQIds = new Set(ANSWER_REGISTRY.map((m) => m.questionId));
    for (const sqId of sessionQIds) {
      assert.ok(registeredQIds.has(sqId), `No answers for session question: ${sqId}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readLifestyle — V2-A1 canonical lifestyle field accessor
// ─────────────────────────────────────────────────────────────────────────────

describe("readLifestyle", () => {
  it("null returns []", () => {
    assert.deepEqual(readLifestyle(null), []);
  });

  it("undefined returns []", () => {
    assert.deepEqual(readLifestyle(undefined), []);
  });

  it("empty string returns []", () => {
    assert.deepEqual(readLifestyle(""), []);
  });

  it("single value returns single-element array", () => {
    assert.deepEqual(readLifestyle("professional"), ["professional"]);
  });

  it("comma-joined string splits correctly", () => {
    assert.deepEqual(readLifestyle("professional,casual,creative"), ["professional", "casual", "creative"]);
  });

  it("trims whitespace around entries", () => {
    assert.deepEqual(readLifestyle("professional, casual ,  creative  "), ["professional", "casual", "creative"]);
  });

  it("filters out empty entries from double commas", () => {
    assert.deepEqual(readLifestyle("professional,,casual"), ["professional", "casual"]);
  });

  it("preserves stored order — does not sort", () => {
    assert.deepEqual(readLifestyle("casual,professional,student"), ["casual", "professional", "student"]);
  });

  it("existing >3 values are returned intact — no truncation", () => {
    const result = readLifestyle("professional,casual,creative,student,travel");
    assert.equal(result.length, 5);
    assert.deepEqual(result, ["professional", "casual", "creative", "student", "travel"]);
  });

  it("whitespace-only entries are filtered out", () => {
    assert.deepEqual(readLifestyle("professional, ,casual"), ["professional", "casual"]);
  });
});
