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
]);

const ARRAY_FIELDS = [
  "stylePersonalities", "desiredImpression", "lifestyle", "desiredFeelings",
  "becoming", "fitPreferences", "styleStruggles", "favoriteColors",
  "avoidColors", "styleSupport",
  // V2-B1 array fields (no quiz-option validation yet — UI doesn't exist)
  "silhouette", "coveragePreferences", "shoppingPriorities",
];

// V2-B1 free-text fields (string | null); validated same pattern as finalNotes.
const B1_TEXT_FIELDS = [
  "structure", "neutralVsColour", "colourIntensity", "printAppetite", "trendAppetite",
];
// Character limits per field (trimmed length).
const B1_TEXT_MAX = { structure: 200, neutralVsColour: 200, colourIntensity: 200, printAppetite: 200, trendAppetite: 200 };

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

  // Reject unknown top-level keys
  for (const key of Object.keys(body)) {
    if (key !== "baseProfileUpdatedAt" && !RECOGNISED_FIELDS.has(key)) {
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

  // lifestyle max-3: submitted arrays with more than 3 IDs are rejected.
  // Existing stored values with >3 IDs are not modified by reads or unrelated saves.
  if (Object.hasOwn(body, "lifestyle") && !isLifestyleCountValid(body["lifestyle"])) {
    return Response.json({ error: "lifestyle_too_many" }, { status: 400 });
  }

  const op = customer.onboardingProfile;

  // All submitted values are validated. Absent keys fall back to the saved DB value
  // (partial-patch behaviour: a caller sending only changed fields is supported).
  const pickArr = (key, fallback) =>
    Object.hasOwn(body, key) ? body[key] : (fallback ?? []);

  const pickText = (key, fallback) => {
    if (!Object.hasOwn(body, key)) return fallback ?? null;
    const v = body[key];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };

  // lifestyle is stored as a comma-joined String? to avoid a schema migration.
  const pickLifestyle = (fallback) => {
    if (!Object.hasOwn(body, "lifestyle")) return fallback ?? null;
    const v = body["lifestyle"];
    return v.length > 0 ? v.join(", ") : null;
  };

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
    lifestyle:           pickLifestyle(op?.lifestyle),
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
