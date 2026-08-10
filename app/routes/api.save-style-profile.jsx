import prisma from "../db.server";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import { quizQuestions } from "../lib/onboarding/quiz-data";
import { emitPassportSaved, recordJourneyEventAwaited } from "../lib/ai/journey-events.server";
import {
  LIFESTYLE_MAX,
  TYPICAL_DAY_MAX,
  isLifestyleCountValid,
  resolveColourConflict,
  deriveFitMigration,
  normalizeTypicalDay,
} from "../lib/passport/v2-b1-helpers";

const RECOGNISED_FIELDS = new Set([
  "stylePersonalities", "desiredImpression", "lifestyle", "desiredFeelings",
  "becoming", "fitPreferences", "styleStruggles", "favoriteColors",
  "avoidColors", "styleSupport", "finalNotes",
  // V2-B1
  "silhouette", "structure", "coveragePreferences", "typicalDay",
  "neutralVsColour", "colourIntensity", "printAppetite", "shoppingPriorities",
  "trendAppetite",
  // V2-C
  "bodyFocusAreas", "bodyAvoidAreas",
  // V2-D / V2-F
  "sizingSystem", "topSize", "bottomSize", "dressSize",
  "shoeSizingSystem", "shoeSize",
  "height", "bustMeasurement", "waistMeasurement", "hipMeasurement",
  "measurementUnit", "bodyShape", "fitConcerns", "preferredCoverage",
]);

const ARRAY_FIELDS = [
  "stylePersonalities", "desiredImpression", "lifestyle", "desiredFeelings",
  "becoming", "fitPreferences", "styleStruggles", "favoriteColors",
  "avoidColors", "styleSupport",
  // V2-B1 array fields (no quiz-option validation yet — UI doesn't exist)
  "silhouette", "coveragePreferences", "shoppingPriorities",
  // V2-C
  "bodyFocusAreas", "bodyAvoidAreas",
  // V2-D
  "fitConcerns",
];

// V2-B1 free-text fields (string | null); validated same pattern as finalNotes.
const B1_TEXT_FIELDS = [
  "structure", "neutralVsColour", "colourIntensity", "printAppetite", "trendAppetite",
];
// Character limits per field (trimmed length).
const B1_TEXT_MAX = { structure: 200, neutralVsColour: 200, colourIntensity: 200, printAppetite: 200, trendAppetite: 200 };

// V2-C: body-area pickers
const FOCUS_VALID_IDS = new Set(["waist", "arms-shoulders", "legs", "neckline", "back", "bust", "hips-curves"]);
const AVOID_VALID_IDS = new Set(["upper-arms", "midriff", "bust", "hips-thighs", "back", "legs", "waist", "neckline"]);
const MAX_BODY_AREAS  = 5;

// Semantic overlap maps (server-side safety net; UI already enforces mutual exclusion)
const FOCUS_TO_AVOID_NORM = {
  "waist": "waist", "arms-shoulders": "upper-arms", "legs": "legs",
  "neckline": "neckline", "back": "back", "bust": "bust", "hips-curves": "hips-thighs",
};
const AVOID_TO_FOCUS_NORM = {
  "waist": "waist", "legs": "legs", "neckline": "neckline", "back": "back",
  "bust": "bust", "upper-arms": "arms-shoulders", "hips-thighs": "hips-curves",
};

// V2-E: lifestyle valid IDs (matches quiz-data.ts question "lifestyle")
const LIFESTYLE_VALID_IDS = new Set(["office", "busy-mom", "creative", "casual-days", "events", "always-on-the-go", "travel", "hybrid"]);

// V2-D: validation constants
const SIZING_SYSTEM_VALID    = new Set(["uk", "us", "eu", "international", "other"]);
// V2-F: shoe sizing system — no "international" option
const SHOE_SIZING_SYSTEM_VALID = new Set(["uk", "us", "eu", "other"]);
const BODY_SHAPE_VALID       = new Set(["hourglass", "pear", "apple", "rectangle", "inverted-triangle", "not-sure", "prefer-not-to-say"]);
const FIT_CONCERN_VALID      = new Set(["petite", "tall", "short-torso", "long-torso", "broad-shoulders", "narrow-shoulders", "fuller-bust", "narrow-hips", "arm-fit", "thigh-fit"]);
const PREFERRED_COVERAGE_VALID = new Set(["mostly-covered", "balanced", "varies", "more-open"]);
const MEASUREMENT_UNIT_VALID = new Set(["cm", "in"]);

const CLOTHING_SIZES = {
  uk:            new Set(["4","6","8","10","12","14","16","18","20","22","24"]),
  us:            new Set(["0","2","4","6","8","10","12","14","16","18"]),
  eu:            new Set(["32","34","36","38","40","42","44","46","48","50"]),
  international: new Set(["XS","S","M","L","XL","XXL","XXXL"]),
};
const SHOE_SIZES = {
  uk: new Set(["2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5"]),
  us: new Set(["4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","10.5"]),
  eu: new Set(["34","35","36","37","38","39","40","41","42","43","44"]),
  // international: no shoe size
};

function validateClothingSize(value, system) {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || value.length > 50) return false;
  if (system && system !== "other") {
    const valid = CLOTHING_SIZES[system];
    if (valid && !valid.has(value.trim())) return false;
  }
  return true;
}

// shoeSystem is the independent shoeSizingSystem (uk/us/eu/other); never "international"
function validateShoeSize(value, shoeSystem) {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || value.length > 10) return false;
  if (shoeSystem && shoeSystem !== "other") {
    const valid = SHOE_SIZES[shoeSystem];
    if (valid && !valid.has(value.trim())) return false;
  }
  return true;
}

function validateHeight(value) {
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  const cm = value.match(/^(\d+)cm$/);
  if (cm) { const n = parseInt(cm[1]); return n >= 100 && n <= 250; }
  const ftIn = value.match(/^(\d+)ft (\d+)in$/);
  if (ftIn) { const ft = parseInt(ftIn[1]); const i = parseInt(ftIn[2]); return ft >= 3 && ft <= 8 && i >= 0 && i <= 11; }
  return false;
}

function validateMeasurement(value) {
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return false;
  const n = parseFloat(value);
  return n > 0 && n <= 999;
}

// Valid option IDs and max selection counts per field — derived from quiz data at module load time
const VALID_OPTION_IDS = {};
const MAX_SELECTIONS = {};
for (const q of quizQuestions) {
  if (q.options) VALID_OPTION_IDS[q.id] = new Set(q.options.map(o => o.id));
  if (q.colors)  VALID_OPTION_IDS[q.id] = new Set(q.colors.map(c => c.id));
  if (q.maxSelections !== undefined) MAX_SELECTIONS[q.id] = q.maxSelections;
}

// Maps API field names to their quiz question IDs
const FIELD_TO_QUESTION_ID = {
  stylePersonalities: "style-personalities",
  desiredImpression:  "desired-impression",
  lifestyle:          "lifestyle",
  desiredFeelings:    "desired-feelings",
  becoming:           "becoming",
  fitPreferences:     "fit-preferences",
  styleStruggles:     "wardrobe-disconnection",
  favoriteColors:     "favorite-colors",
  avoidColors:        "avoid-colors",
  styleSupport:       "style-support",
};

export async function action({ request }) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return Response.json({ error: "not_authenticated" }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }

  // Body must be a non-null, non-array object
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // baseProfileUpdatedAt must be present and be a string or null
  if (!Object.hasOwn(body, "baseProfileUpdatedAt")) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { baseProfileUpdatedAt } = body;
  if (baseProfileUpdatedAt !== null && typeof baseProfileUpdatedAt !== "string") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // request-only keys (allowed but not in RECOGNISED_FIELDS, never persisted)
  const REQUEST_ONLY_KEYS = new Set(["baseProfileUpdatedAt", "editedField", "confirmSizeSystemChange"]);
  // Reject unknown top-level keys
  for (const key of Object.keys(body)) {
    if (!REQUEST_ONLY_KEYS.has(key) && !RECOGNISED_FIELDS.has(key)) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  // Require at least one recognised Passport field
  if (!Object.keys(body).some(k => RECOGNISED_FIELDS.has(k))) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // Array fields, if present, must be arrays of strings
  for (const field of ARRAY_FIELDS) {
    if (Object.hasOwn(body, field)) {
      const v = body[field];
      if (!Array.isArray(v) || !v.every(item => typeof item === "string")) {
        return Response.json({ error: "invalid_body" }, { status: 400 });
      }
    }
  }

  // Each item must be a known option ID; no duplicates; within maxSelections ([] is always valid)
  for (const [apiField, questionId] of Object.entries(FIELD_TO_QUESTION_ID)) {
    if (Object.hasOwn(body, apiField)) {
      const v = body[apiField];
      if (v.length > 0) {
        if (!v.every(item => VALID_OPTION_IDS[questionId]?.has(item))) {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        if (new Set(v).size !== v.length) {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        const max = MAX_SELECTIONS[questionId];
        if (max !== undefined && v.length > max) {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
      }
    }
  }

  // finalNotes, if present, must be a string or null, max 500 chars
  if (Object.hasOwn(body, "finalNotes")) {
    const v = body["finalNotes"];
    if (v !== null && typeof v !== "string") {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    if (typeof v === "string" && v.length > 500) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  // V2-B1 text fields: string | null; each has a max character limit.
  for (const field of B1_TEXT_FIELDS) {
    if (Object.hasOwn(body, field)) {
      const v = body[field];
      if (v !== null && typeof v !== "string") {
        return Response.json({ error: "invalid_body" }, { status: 400 });
      }
      if (typeof v === "string" && v.length > B1_TEXT_MAX[field]) {
        return Response.json({ error: "invalid_body" }, { status: 400 });
      }
    }
  }

  // typicalDay: string | null, trimmed, max 500 chars.
  if (Object.hasOwn(body, "typicalDay")) {
    const v = body["typicalDay"];
    if (v !== null && typeof v !== "string") {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    if (typeof v === "string" && v.trim().length > TYPICAL_DAY_MAX) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  // lifestyle: max-3 and approved IDs only; legacy stored values with >3 IDs are untouched
  if (Object.hasOwn(body, "lifestyle")) {
    const ls = body["lifestyle"];
    if (!isLifestyleCountValid(ls)) {
      return Response.json({ error: "lifestyle_too_many" }, { status: 400 });
    }
    if (!ls.every(id => LIFESTYLE_VALID_IDS.has(id))) {
      return Response.json({ error: "lifestyle_invalid_id" }, { status: 400 });
    }
  }

  // V2-C: body-area arrays — valid IDs, max 5, no duplicates
  if (Object.hasOwn(body, "bodyFocusAreas")) {
    const v = body["bodyFocusAreas"];
    if (v.length > MAX_BODY_AREAS || new Set(v).size !== v.length ||
        !v.every(id => FOCUS_VALID_IDS.has(id))) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }
  if (Object.hasOwn(body, "bodyAvoidAreas")) {
    const v = body["bodyAvoidAreas"];
    if (v.length > MAX_BODY_AREAS || new Set(v).size !== v.length ||
        !v.every(id => AVOID_VALID_IDS.has(id))) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  // V2-D / V2-F: single-value enum fields
  if (Object.hasOwn(body, "sizingSystem")) {
    const v = body["sizingSystem"];
    if (v !== null && (typeof v !== "string" || !SIZING_SYSTEM_VALID.has(v))) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }
  if (Object.hasOwn(body, "shoeSizingSystem")) {
    const v = body["shoeSizingSystem"];
    if (v !== null && (typeof v !== "string" || !SHOE_SIZING_SYSTEM_VALID.has(v))) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }
  if (Object.hasOwn(body, "measurementUnit")) {
    const v = body["measurementUnit"];
    if (v !== null && (typeof v !== "string" || !MEASUREMENT_UNIT_VALID.has(v))) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }
  if (Object.hasOwn(body, "bodyShape")) {
    const v = body["bodyShape"];
    if (v !== null && (typeof v !== "string" || !BODY_SHAPE_VALID.has(v))) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }
  if (Object.hasOwn(body, "preferredCoverage")) {
    const v = body["preferredCoverage"];
    if (v !== null && (typeof v !== "string" || !PREFERRED_COVERAGE_VALID.has(v))) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  // V2-D: fitConcerns — valid IDs, no duplicates
  if (Object.hasOwn(body, "fitConcerns")) {
    const v = body["fitConcerns"];
    if (!v.every(id => FIT_CONCERN_VALID.has(id)) || new Set(v).size !== v.length) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  // V2-D: height
  if (Object.hasOwn(body, "height")) {
    if (!validateHeight(body["height"])) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  // V2-D: measurements
  for (const field of ["bustMeasurement", "waistMeasurement", "hipMeasurement"]) {
    if (Object.hasOwn(body, field) && !validateMeasurement(body[field])) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  const op = customer.onboardingProfile;

  // V2-D/V2-F: clothing sizing system change safety (affects topSize/bottomSize/dressSize only)
  const savedSizingSystem = op?.sizingSystem ?? null;
  const effectiveSizingSystem = Object.hasOwn(body, "sizingSystem")
    ? (typeof body["sizingSystem"] === "string" && body["sizingSystem"] !== "" ? body["sizingSystem"] : null)
    : savedSizingSystem;
  const sizingSystemChanging = effectiveSizingSystem !== savedSizingSystem;
  const hasSavedClothingSizes = op && (op.topSize || op.bottomSize || op.dressSize);
  // Require confirmation when clothing system changes and any clothing size is saved
  if (sizingSystemChanging && hasSavedClothingSizes && body["confirmSizeSystemChange"] !== true) {
    return Response.json({ error: "size_system_change_requires_confirmation" }, { status: 409 });
  }
  const clearClothingOnSystemChange = sizingSystemChanging && body["confirmSizeSystemChange"] === true;

  // V2-F: shoe sizing system change safety (independent from clothing system)
  const savedShoeSizingSystem = op?.shoeSizingSystem ?? null;
  const effectiveShoeSizingSystem = Object.hasOwn(body, "shoeSizingSystem")
    ? (typeof body["shoeSizingSystem"] === "string" && body["shoeSizingSystem"] !== "" ? body["shoeSizingSystem"] : null)
    : savedShoeSizingSystem;
  const shoeSizingSystemChanging = effectiveShoeSizingSystem !== savedShoeSizingSystem;
  const hasSavedShoeSize = op?.shoeSize;
  // Require confirmation when shoe system changes and a shoe size is already saved
  if (shoeSizingSystemChanging && hasSavedShoeSize && body["confirmShoeSystemChange"] !== true) {
    return Response.json({ error: "shoe_system_change_requires_confirmation" }, { status: 409 });
  }
  const clearShoeOnSystemChange = shoeSizingSystemChanging && body["confirmShoeSystemChange"] === true;

  // V2-D: clothing sizes — validate against effective clothing system
  for (const field of ["topSize", "bottomSize", "dressSize"]) {
    if (Object.hasOwn(body, field) && !validateClothingSize(body[field], effectiveSizingSystem)) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }
  // V2-F: shoe size — validate against effective shoe system (independent)
  if (Object.hasOwn(body, "shoeSize") && !validateShoeSize(body["shoeSize"], effectiveShoeSizingSystem)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // All submitted values are validated. Absent keys fall back to the saved DB value
  // (partial-patch behaviour: a caller sending only changed fields is supported).
  const pickArr = (key, fallback) =>
    Object.hasOwn(body, key) ? body[key] : (fallback ?? []);

  const pickText = (key, fallback) => {
    if (!Object.hasOwn(body, key)) return fallback ?? null;
    const v = body[key];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };

  // V2-C: body-area mutual-exclusion normalization (server-side safety net)
  // editedField determines which picker wins when a conflict reaches the server; missing/invalid → focus wins
  const editedBodyField = body["editedField"] === "bodyAvoidAreas" ? "bodyAvoidAreas" : "bodyFocusAreas";
  const rawFocusAreas = pickArr("bodyFocusAreas", op?.bodyFocusAreas).filter(id => FOCUS_VALID_IDS.has(id));
  const rawAvoidAreas = pickArr("bodyAvoidAreas", op?.bodyAvoidAreas).filter(id => AVOID_VALID_IDS.has(id));
  let normalizedFocusAreas = rawFocusAreas;
  let normalizedAvoidAreas = rawAvoidAreas;
  if (editedBodyField === "bodyFocusAreas") {
    const avoidConflicts = new Set(normalizedFocusAreas.map(id => FOCUS_TO_AVOID_NORM[id]).filter(Boolean));
    normalizedAvoidAreas = normalizedAvoidAreas.filter(id => !avoidConflicts.has(id));
  } else {
    const focusConflicts = new Set(normalizedAvoidAreas.map(id => AVOID_TO_FOCUS_NORM[id]).filter(Boolean));
    normalizedFocusAreas = normalizedFocusAreas.filter(id => !focusConflicts.has(id));
  }

  // Resolve favourite/avoid colour conflict: avoid wins.
  const rawFavorites = pickArr("favoriteColors", op?.favoriteColors);
  const rawAvoids    = pickArr("avoidColors",    op?.avoidColors);
  const resolvedFavorites = resolveColourConflict(rawFavorites, rawAvoids);

  // fitPreferences additive migration (idempotent — never overwrites set values).
  const fitPrefsToSave = pickArr("fitPreferences", op?.fitPreferences);
  const existingSilhouette = Object.hasOwn(body, "silhouette") ? body["silhouette"] : (op?.silhouette ?? []);
  const existingStructure  = Object.hasOwn(body, "structure")  ? body["structure"]  : (op?.structure  ?? null);
  const { silhouette: resolvedSilhouette, structure: resolvedStructure } = deriveFitMigration(
    fitPrefsToSave,
    existingSilhouette,
    existingStructure,
  );

  const profileData = {
    stylePersonalities:  pickArr("stylePersonalities",  op?.stylePersonalities),
    desiredImpression:   pickArr("desiredImpression",   op?.desiredImpression),
    lifestyle:           pickArr("lifestyle",         op?.lifestyle ?? []),
    desiredFeelings:     pickArr("desiredFeelings",     op?.desiredFeelings),
    becoming:            pickArr("becoming",            op?.becoming),
    fitPreferences:      fitPrefsToSave,
    styleStruggles:      pickArr("styleStruggles",      op?.styleStruggles),
    favoriteColors:      resolvedFavorites,
    avoidColors:         rawAvoids,
    styleSupport:        pickArr("styleSupport",        op?.styleSupport),
    finalNotes:          pickText("finalNotes",         op?.finalNotes),
    // V2-B1 fields
    silhouette:          resolvedSilhouette,
    structure:           resolvedStructure,
    coveragePreferences: pickArr("coveragePreferences", op?.coveragePreferences),
    typicalDay:          normalizeTypicalDay(Object.hasOwn(body, "typicalDay") ? body["typicalDay"] : op?.typicalDay),
    neutralVsColour:     pickText("neutralVsColour",    op?.neutralVsColour),
    colourIntensity:     pickText("colourIntensity",    op?.colourIntensity),
    printAppetite:       pickText("printAppetite",      op?.printAppetite),
    shoppingPriorities:  pickArr("shoppingPriorities",  op?.shoppingPriorities),
    trendAppetite:       pickText("trendAppetite",      op?.trendAppetite),
    // V2-C
    bodyFocusAreas:      normalizedFocusAreas,
    bodyAvoidAreas:      normalizedAvoidAreas,
    // V2-D/V2-F sizes
    // Clothing system change (confirmed) clears top/bottom/dress only — never shoe
    sizingSystem:        pickText("sizingSystem",       op?.sizingSystem),
    topSize:             clearClothingOnSystemChange ? null : pickText("topSize",    op?.topSize),
    bottomSize:          clearClothingOnSystemChange ? null : pickText("bottomSize", op?.bottomSize),
    dressSize:           clearClothingOnSystemChange ? null : pickText("dressSize",  op?.dressSize),
    // Shoe system change (confirmed) clears shoeSize only — never clothing sizes
    shoeSizingSystem:    pickText("shoeSizingSystem",   op?.shoeSizingSystem),
    shoeSize:            clearShoeOnSystemChange ? null : pickText("shoeSize",       op?.shoeSize),
    // V2-D measurements
    height:              pickText("height",            op?.height),
    bustMeasurement:     pickText("bustMeasurement",   op?.bustMeasurement),
    waistMeasurement:    pickText("waistMeasurement",  op?.waistMeasurement),
    hipMeasurement:      pickText("hipMeasurement",    op?.hipMeasurement),
    measurementUnit:     pickText("measurementUnit",   op?.measurementUnit),
    // V2-D proportions & fit
    bodyShape:           pickText("bodyShape",         op?.bodyShape),
    fitConcerns:         pickArr("fitConcerns",        op?.fitConcerns),
    preferredCoverage:   pickText("preferredCoverage", op?.preferredCoverage),
    completed:           true,
  };

  if (op) {
    // Existing profile — fast early check before the DB write
    if (op.updatedAt.toISOString() !== baseProfileUpdatedAt) {
      return Response.json({ error: "profile_changed" }, { status: 409 });
    }

    // Atomic write: WHERE includes both id and the exact updatedAt read above.
    // A concurrent write will advance updatedAt so count === 0.
    const result = await prisma.onboardingProfile.updateMany({
      where: { id: op.id, updatedAt: op.updatedAt },
      data:  profileData,
    });

    if (result.count !== 1) {
      return Response.json({ error: "profile_changed" }, { status: 409 });
    }
    // Awaited with idempotency key — one event per distinct profile update (CAS ensures uniqueness)
    // Key includes baseProfileUpdatedAt so each successful update gets its own event.
    try {
      const nonEmptyFields = Object.values(profileData).filter(v =>
        Array.isArray(v) ? v.length > 0 : v != null && v !== ""
      ).length;
      await recordJourneyEventAwaited(
        emitPassportSaved({ customerId: customer.id, isFirstCompletion: false, fieldCount: nonEmptyFields }),
        `passport_updated:${op.id}:${baseProfileUpdatedAt}:v1`,
      );
    } catch { /* event emission never blocks the response */ }
  } else {
    // No existing profile — allow create only when draft was based on a clean slate
    if (baseProfileUpdatedAt !== null) {
      return Response.json({ error: "profile_changed" }, { status: 409 });
    }

    let newProfile;
    try {
      newProfile = await prisma.onboardingProfile.create({
        data: { customerId: customer.id, ...profileData },
        select: { id: true },
      });
    } catch (err) {
      // P2002 = unique-constraint violation: concurrent create for same customer
      if (err?.code === "P2002") {
        return Response.json({ error: "profile_changed" }, { status: 409 });
      }
      throw err;
    }
    // Awaited with idempotency key — one event per profile (keyed on profile id)
    try {
      const nonEmptyFields = Object.values(profileData).filter(v =>
        Array.isArray(v) ? v.length > 0 : v != null && v !== ""
      ).length;
      await recordJourneyEventAwaited(
        emitPassportSaved({ customerId: customer.id, isFirstCompletion: true, fieldCount: nonEmptyFields }),
        `passport_completed:${newProfile.id}:v1`,
      );
    } catch { /* event emission never blocks the response */ }
  }

  return Response.json({ success: true });
}
