import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateStyleMeProfileInput,
  checkApprovalCompleteness,
  StyleMeProfileValidationError,
  EXACT_SLOT_VALUES,
  OUTFIT_FUNCTION_VALUES,
  STYLE_FAMILY_VALUES,
  DRESS_REGISTER_VALUES,
  CONSTRUCTION_VALUES,
  FABRIC_BEHAVIOUR_VALUES,
  SILHOUETTE_CHARACTER_VALUES,
  VISUAL_WEIGHT_VALUES,
  STYLING_EFFORT_VALUES,
  LAYERING_BEHAVIOUR_VALUES,
  WAIST_COMFORT_VALUES,
  STATEMENT_LEVEL_VALUES,
  OCCASION_IDS,
  OCCASION_FIT_RATINGS,
  INTENTION_IDS,
  INTENTION_RATINGS,
  PROFILE_STATUS_VALUES,
} from "./styleme-garment-profile.server";
import type { StyleMeProfileInput } from "./styleme-garment-profile.server";

// ── SGP-V: Vocabulary constant integrity ──────────────────────────────────────

describe("SGP-V01 vocabulary constants have expected values", () => {
  it("exactSlot contains all 9 slots", () => {
    assert.equal(EXACT_SLOT_VALUES.length, 9);
    assert.ok(EXACT_SLOT_VALUES.includes("top"));
    assert.ok(EXACT_SLOT_VALUES.includes("jewelry"));
  });

  it("silhouetteCharacter contains 13 values including flare/bootcut, A-line, and N/A", () => {
    assert.equal(SILHOUETTE_CHARACTER_VALUES.length, 13);
    assert.ok(SILHOUETTE_CHARACTER_VALUES.includes("flare/bootcut"));
    assert.ok(SILHOUETTE_CHARACTER_VALUES.includes("A-line"));
    assert.ok(SILHOUETTE_CHARACTER_VALUES.includes("wide-leg"));
    assert.ok(SILHOUETTE_CHARACTER_VALUES.includes("N/A"));
  });

  it("fabricBehaviour includes N/A", () => {
    assert.ok(FABRIC_BEHAVIOUR_VALUES.includes("N/A"));
  });

  it("construction includes N/A", () => {
    assert.ok(CONSTRUCTION_VALUES.includes("N/A"));
  });

  it("layeringBehaviour includes N/A", () => {
    assert.ok(LAYERING_BEHAVIOUR_VALUES.includes("N/A"));
  });

  it("waistComfort includes N/A", () => {
    assert.ok(WAIST_COMFORT_VALUES.includes("N/A"));
  });

  it("occasions has exactly 9 IDs", () => {
    assert.equal(OCCASION_IDS.length, 9);
    assert.ok(OCCASION_IDS.includes("night-out"));
  });

  it("intentions has exactly 12 IDs", () => {
    assert.equal(INTENTION_IDS.length, 12);
    assert.ok(INTENTION_IDS.includes("feel-less-exposed"));
  });

  it("profileStatus has 3 values", () => {
    assert.equal(PROFILE_STATUS_VALUES.length, 3);
    assert.ok(PROFILE_STATUS_VALUES.includes("in-review"));
  });
});

// ── SGP-V02: Valid input passes validation ─────────────────────────────────────

describe("SGP-V02 valid inputs pass without error", () => {
  it("fully-populated valid input", () => {
    const input: StyleMeProfileInput = {
      profileStatus: "approved",
      exactSlot: "top",
      outfitFunction: "base",
      styleFamilyPrimary: "classic",
      styleFamilySecondary: "minimal",
      dressRegister: "smart-casual",
      construction: "structured",
      fabricBehaviour: ["crisp", "soft"],
      silhouetteCharacter: ["fitted", "straight"],
      visualWeight: "medium",
      stylingEffort: "easy",
      layeringBehaviour: "standalone",
      waistComfort: "N/A",
      statementLevel: "quiet",
      occasionFit: { everyday: "Strong", work: "Acceptable", active: "No" },
      intentionPotentials: { "feel-like-myself": "Strong", confidence: "Supporting" },
      naturalPairings: "tailored trousers",
      intentionalMix: "denim for casual mixing",
      avoidInStyleMe: "athleisure bottoms",
      specialNotes: "test note",
    };
    const result = validateStyleMeProfileInput(input);
    assert.equal(result.exactSlot, "top");
    assert.equal(result.profileStatus, "approved");
  });

  it("empty input passes (all fields optional)", () => {
    assert.doesNotThrow(() => validateStyleMeProfileInput({}));
  });

  it("null scalar fields pass", () => {
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ exactSlot: null, visualWeight: null }),
    );
  });

  it("styleFamilySecondary: 'none' is valid", () => {
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ styleFamilySecondary: "none" }),
    );
  });

  it("empty arrays pass", () => {
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ fabricBehaviour: [], silhouetteCharacter: [] }),
    );
  });

  it("N/A is valid for construction", () => {
    assert.doesNotThrow(() => validateStyleMeProfileInput({ construction: "N/A" }));
  });
});

// ── SGP-V03: Invalid values throw ─────────────────────────────────────────────

describe("SGP-V03 invalid values throw StyleMeProfileValidationError", () => {
  it("invalid exactSlot", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ exactSlot: "pants" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid outfitFunction", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ outfitFunction: "hero" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid styleFamilyPrimary", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ styleFamilyPrimary: "boho" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid styleFamilySecondary", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ styleFamilySecondary: "boho" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid dressRegister", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ dressRegister: "formal" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid construction value", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ construction: "rigid" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid visualWeight", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ visualWeight: "extra-heavy" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid stylingEffort", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ stylingEffort: "effortful" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid statementLevel", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ statementLevel: "loud" }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid profileStatus", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ profileStatus: "done" as "approved" }),
      StyleMeProfileValidationError,
    );
  });
});

// ── SGP-V04: Multi-select array validation ────────────────────────────────────

describe("SGP-V04 multi-select array validation", () => {
  it("invalid fabricBehaviour value in array", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ fabricBehaviour: ["soft", "bouncy"] }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid silhouetteCharacter value in array", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ silhouetteCharacter: ["fitted", "baggy"] }),
      StyleMeProfileValidationError,
    );
  });

  it("all valid fabricBehaviour values pass", () => {
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ fabricBehaviour: [...FABRIC_BEHAVIOUR_VALUES] }),
    );
  });

  it("all valid silhouetteCharacter values pass", () => {
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ silhouetteCharacter: [...SILHOUETTE_CHARACTER_VALUES] }),
    );
  });

  it("N/A is a valid silhouetteCharacter value", () => {
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ silhouetteCharacter: ["N/A"] }),
    );
  });
});

// ── SGP-V05: occasionFit JSON validation ──────────────────────────────────────

describe("SGP-V05 occasionFit JSON validation", () => {
  it("all valid occasion IDs and ratings pass", () => {
    const fit: Record<string, string> = {};
    for (const id of OCCASION_IDS) {
      fit[id] = OCCASION_FIT_RATINGS[0];
    }
    assert.doesNotThrow(() => validateStyleMeProfileInput({ occasionFit: fit }));
  });

  it("unknown occasion key throws", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ occasionFit: { brunch: "Strong" } }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid rating for valid occasion throws", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ occasionFit: { work: "Maybe" } }),
      StyleMeProfileValidationError,
    );
  });

  it("null occasionFit passes", () => {
    assert.doesNotThrow(() => validateStyleMeProfileInput({ occasionFit: null }));
  });

  it("partial occasionFit (only some occasions rated) passes", () => {
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ occasionFit: { everyday: "Strong", work: "No" } }),
    );
  });
});

// ── SGP-V06: intentionPotentials JSON validation ───────────────────────────────

describe("SGP-V06 intentionPotentials JSON validation", () => {
  it("all 12 valid intention IDs pass", () => {
    const potentials: Record<string, string> = {};
    for (const id of INTENTION_IDS) {
      potentials[id] = "Supporting";
    }
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ intentionPotentials: potentials }),
    );
  });

  it("unknown intention key throws", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ intentionPotentials: { "look-tall": "Strong" } }),
      StyleMeProfileValidationError,
    );
  });

  it("invalid rating throws", () => {
    assert.throws(
      () => validateStyleMeProfileInput({ intentionPotentials: { confidence: "Weak" } }),
      StyleMeProfileValidationError,
    );
  });

  it("null intentionPotentials passes", () => {
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ intentionPotentials: null }),
    );
  });
});

// ── SGP-V07: Incomplete profile allowed for IN REVIEW ─────────────────────────

describe("SGP-V07 incomplete profile is allowed for in-review status", () => {
  it("empty profile has completeness errors but passes vocab validation", () => {
    // Vocab validation passes — no values to reject
    assert.doesNotThrow(() => validateStyleMeProfileInput({}));
    // Completeness check reports all required fields missing
    const errors = checkApprovalCompleteness({});
    assert.ok(errors.length > 0, "expected completeness errors for empty profile");
  });

  it("partial profile with only exactSlot set still has completeness errors", () => {
    const partial: StyleMeProfileInput = { exactSlot: "top" };
    const errors = checkApprovalCompleteness(partial);
    assert.ok(errors.length > 0);
    assert.ok(!errors.some((e) => e.field === "exactSlot"), "exactSlot should not be in errors");
    assert.ok(errors.some((e) => e.field === "outfitFunction"), "outfitFunction should be missing");
  });

  it("in-review does not trigger completeness check in validateStyleMeProfileInput", () => {
    // validateStyleMeProfileInput only checks vocab — completeness is separate
    assert.doesNotThrow(() =>
      validateStyleMeProfileInput({ profileStatus: "in-review", exactSlot: null }),
    );
  });

  it("all required scalar fields set but missing occasion ratings reports occasionFit errors", () => {
    const almostComplete: StyleMeProfileInput = {
      exactSlot: "top",
      outfitFunction: "base",
      styleFamilyPrimary: "classic",
      dressRegister: "casual",
      construction: "soft",
      fabricBehaviour: ["soft"],
      silhouetteCharacter: ["fitted"],
      visualWeight: "light",
      stylingEffort: "easy",
      layeringBehaviour: "standalone",
      waistComfort: "N/A",
      statementLevel: "quiet",
      // intentionPotentials and occasionFit absent
    };
    const errors = checkApprovalCompleteness(almostComplete);
    const fields = errors.map((e) => e.field);
    assert.ok(fields.every((f) => f === "occasionFit" || f === "intentionPotentials"),
      `only occasion/intention errors expected, got: ${fields.join(", ")}`);
    assert.ok(fields.includes("occasionFit"));
    assert.ok(fields.includes("intentionPotentials"));
  });
});

// ── SGP-V08: APPROVED requires completeness ───────────────────────────────────

describe("SGP-V08 approved status requires all required fields", () => {
  function fullValidApprovedInput(): StyleMeProfileInput {
    const occasionFit: Record<string, string> = {};
    for (const id of OCCASION_IDS) occasionFit[id] = "Acceptable";
    const intentionPotentials: Record<string, string> = {};
    for (const id of INTENTION_IDS) intentionPotentials[id] = "None";
    return {
      profileStatus: "approved",
      exactSlot: "top",
      outfitFunction: "base",
      styleFamilyPrimary: "classic",
      styleFamilySecondary: "none",
      dressRegister: "smart-casual",
      construction: "structured",
      fabricBehaviour: ["crisp"],
      silhouetteCharacter: ["fitted"],
      visualWeight: "medium",
      stylingEffort: "easy",
      layeringBehaviour: "standalone",
      waistComfort: "N/A",
      statementLevel: "quiet",
      occasionFit,
      intentionPotentials,
    };
  }

  it("fully complete profile has zero completeness errors", () => {
    const errors = checkApprovalCompleteness(fullValidApprovedInput());
    assert.equal(errors.length, 0, `expected no errors, got: ${errors.map((e) => e.message).join("; ")}`);
  });

  it("missing exactSlot yields completeness error", () => {
    const input = fullValidApprovedInput();
    delete input.exactSlot;
    const errors = checkApprovalCompleteness(input);
    assert.ok(errors.some((e) => e.field === "exactSlot"));
  });

  it("empty fabricBehaviour array yields completeness error", () => {
    const input = { ...fullValidApprovedInput(), fabricBehaviour: [] };
    const errors = checkApprovalCompleteness(input);
    assert.ok(errors.some((e) => e.field === "fabricBehaviour"));
  });

  it("empty silhouetteCharacter array yields completeness error", () => {
    const input = { ...fullValidApprovedInput(), silhouetteCharacter: [] };
    const errors = checkApprovalCompleteness(input);
    assert.ok(errors.some((e) => e.field === "silhouetteCharacter"));
  });

  it('["N/A"] satisfies silhouetteCharacter completeness requirement', () => {
    const input = { ...fullValidApprovedInput(), silhouetteCharacter: ["N/A"] };
    const errors = checkApprovalCompleteness(input);
    assert.ok(!errors.some((e) => e.field === "silhouetteCharacter"),
      'silhouetteCharacter ["N/A"] must not block approval');
    assert.equal(errors.length, 0);
  });

  it("partial occasionFit (missing some occasions) yields completeness errors", () => {
    const input = fullValidApprovedInput();
    input.occasionFit = { everyday: "Strong" }; // only 1 of 9
    const errors = checkApprovalCompleteness(input);
    const occasionErrors = errors.filter((e) => e.field === "occasionFit");
    assert.equal(occasionErrors.length, 8, `expected 8 missing occasion errors, got ${occasionErrors.length}`);
  });

  it("partial intentionPotentials yields completeness errors", () => {
    const input = fullValidApprovedInput();
    input.intentionPotentials = { confidence: "Strong" }; // only 1 of 12
    const errors = checkApprovalCompleteness(input);
    const intentionErrors = errors.filter((e) => e.field === "intentionPotentials");
    assert.equal(intentionErrors.length, 11, `expected 11 missing intention errors, got ${intentionErrors.length}`);
  });

  it("null occasionFit yields all 9 occasion completeness errors", () => {
    const input = { ...fullValidApprovedInput(), occasionFit: null };
    const errors = checkApprovalCompleteness(input);
    const occasionErrors = errors.filter((e) => e.field === "occasionFit");
    assert.equal(occasionErrors.length, 9);
  });

  it("null intentionPotentials yields all 12 intention completeness errors", () => {
    const input = { ...fullValidApprovedInput(), intentionPotentials: null };
    const errors = checkApprovalCompleteness(input);
    const intentionErrors = errors.filter((e) => e.field === "intentionPotentials");
    assert.equal(intentionErrors.length, 12);
  });

  it("styleFamilySecondary is NOT required for approval", () => {
    const input = fullValidApprovedInput();
    delete input.styleFamilySecondary;
    const errors = checkApprovalCompleteness(input);
    assert.ok(!errors.some((e) => e.field === "styleFamilySecondary"));
    assert.equal(errors.length, 0, "styleFamilySecondary must not block approval");
  });

  it("naturalPairings is NOT required for approval", () => {
    const input = { ...fullValidApprovedInput(), naturalPairings: null };
    const errors = checkApprovalCompleteness(input);
    assert.equal(errors.length, 0, "naturalPairings must not block approval");
  });
});
