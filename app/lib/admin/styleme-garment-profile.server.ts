// app/lib/admin/styleme-garment-profile.server.ts
//
// Server-side logic for the StyleMe Garment Profile — the manual audit taxonomy
// that captures hand-curated garment truth for use by StyleMe.
//
// Design constraints:
//   - Completely separate from Closet Intelligence V2. Do not modify Closet
//     Intelligence fields, overrides, or the ClosetItemAdminReview table.
//   - Not wired to live StyleMe recommendation logic yet. Storage + admin UI only.
//   - profileStatus drives the audit workflow: unreviewed → in-review → approved.
//   - Vocabulary constants live in styleme-garment-profile.vocab.ts so they can be
//     imported by client components without pulling in server-only dependencies.

import prisma from "~/db.server";

// ── Re-export vocabulary for server callers ────────────────────────────────────
export {
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
} from "~/lib/admin/styleme-garment-profile.vocab";
export type {
  ExactSlot,
  OutfitFunction,
  StyleFamily,
  DressRegister,
  Construction,
  FabricBehaviour,
  SilhouetteCharacter,
  VisualWeight,
  StylingEffort,
  LayeringBehaviour,
  WaistComfort,
  StatementLevel,
  OccasionId,
  OccasionFitRating,
  IntentionId,
  IntentionRating,
  ProfileStatus,
} from "~/lib/admin/styleme-garment-profile.vocab";
import {
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
  type ProfileStatus,
} from "~/lib/admin/styleme-garment-profile.vocab";

// ── Input / output types ───────────────────────────────────────────────────────

export type StyleMeProfileInput = {
  profileStatus?: ProfileStatus;
  exactSlot?: string | null;
  outfitFunction?: string | null;
  styleFamilyPrimary?: string | null;
  styleFamilySecondary?: string | null;
  dressRegister?: string | null;
  construction?: string | null;
  fabricBehaviour?: string[];
  silhouetteCharacter?: string[];
  visualWeight?: string | null;
  stylingEffort?: string | null;
  layeringBehaviour?: string | null;
  waistComfort?: string | null;
  statementLevel?: string | null;
  occasionFit?: Record<string, string> | null;
  intentionPotentials?: Record<string, string> | null;
  naturalPairings?: string | null;
  intentionalMix?: string | null;
  avoidInStyleMe?: string | null;
  specialNotes?: string | null;
};

export type StyleMeProfileRecord = {
  id: string;
  closetItemId: string;
  profileStatus: ProfileStatus;
  exactSlot: string | null;
  outfitFunction: string | null;
  styleFamilyPrimary: string | null;
  styleFamilySecondary: string | null;
  dressRegister: string | null;
  construction: string | null;
  fabricBehaviour: string[];
  silhouetteCharacter: string[];
  visualWeight: string | null;
  stylingEffort: string | null;
  layeringBehaviour: string | null;
  waistComfort: string | null;
  statementLevel: string | null;
  occasionFit: Record<string, string> | null;
  intentionPotentials: Record<string, string> | null;
  naturalPairings: string | null;
  intentionalMix: string | null;
  avoidInStyleMe: string | null;
  specialNotes: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── Validation ─────────────────────────────────────────────────────────────────

export class StyleMeProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleMeProfileValidationError";
  }
}

function checkVocab(field: string, value: string | null | undefined, allowed: readonly string[]): void {
  if (value === null || value === undefined || value === "") return;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new StyleMeProfileValidationError(
      `Invalid value "${value}" for field "${field}". Allowed: ${allowed.join(", ")}`,
    );
  }
}

function checkArrayVocab(field: string, values: string[], allowed: readonly string[]): void {
  for (const v of values) {
    if (!(allowed as readonly string[]).includes(v)) {
      throw new StyleMeProfileValidationError(
        `Invalid value "${v}" in array field "${field}". Allowed: ${allowed.join(", ")}`,
      );
    }
  }
}

// ── Approval completeness check ────────────────────────────────────────────────
// All required fields must be populated when profileStatus === "approved".
// Returns an array of errors (empty = complete).

export function checkApprovalCompleteness(data: StyleMeProfileInput): StyleMeProfileSaveError[] {
  const errs: StyleMeProfileSaveError[] = [];

  const req = (field: string, value: string | null | undefined) => {
    if (!value) errs.push({ field, message: `${field} is required for approval` });
  };

  req("exactSlot",         data.exactSlot);
  req("outfitFunction",    data.outfitFunction);
  req("styleFamilyPrimary",data.styleFamilyPrimary);
  req("dressRegister",     data.dressRegister);
  req("construction",      data.construction);
  req("visualWeight",      data.visualWeight);
  req("stylingEffort",     data.stylingEffort);
  req("layeringBehaviour", data.layeringBehaviour);
  req("waistComfort",      data.waistComfort);
  req("statementLevel",    data.statementLevel);

  if (!data.fabricBehaviour || data.fabricBehaviour.length === 0) {
    errs.push({ field: "fabricBehaviour", message: "fabricBehaviour requires at least one value for approval" });
  }
  if (!data.silhouetteCharacter || data.silhouetteCharacter.length === 0) {
    errs.push({ field: "silhouetteCharacter", message: "silhouetteCharacter requires at least one value for approval" });
  }

  const occ = data.occasionFit ?? {};
  for (const id of OCCASION_IDS) {
    if (!occ[id]) {
      errs.push({ field: "occasionFit", message: `occasionFit missing rating for "${id}"` });
    }
  }

  const int = data.intentionPotentials ?? {};
  for (const id of INTENTION_IDS) {
    if (!int[id]) {
      errs.push({ field: "intentionPotentials", message: `intentionPotentials missing rating for "${id}"` });
    }
  }

  return errs;
}

export function validateStyleMeProfileInput(data: StyleMeProfileInput): StyleMeProfileInput {
  if (data.profileStatus !== undefined) {
    checkVocab("profileStatus", data.profileStatus, PROFILE_STATUS_VALUES);
  }
  checkVocab("exactSlot", data.exactSlot, EXACT_SLOT_VALUES);
  checkVocab("outfitFunction", data.outfitFunction, OUTFIT_FUNCTION_VALUES);
  checkVocab("styleFamilyPrimary", data.styleFamilyPrimary, STYLE_FAMILY_VALUES);
  if (data.styleFamilySecondary !== null && data.styleFamilySecondary !== undefined) {
    checkVocab("styleFamilySecondary", data.styleFamilySecondary, [...STYLE_FAMILY_VALUES, "none"]);
  }
  checkVocab("dressRegister", data.dressRegister, DRESS_REGISTER_VALUES);
  checkVocab("construction", data.construction, CONSTRUCTION_VALUES);
  checkVocab("visualWeight", data.visualWeight, VISUAL_WEIGHT_VALUES);
  checkVocab("stylingEffort", data.stylingEffort, STYLING_EFFORT_VALUES);
  checkVocab("layeringBehaviour", data.layeringBehaviour, LAYERING_BEHAVIOUR_VALUES);
  checkVocab("waistComfort", data.waistComfort, WAIST_COMFORT_VALUES);
  checkVocab("statementLevel", data.statementLevel, STATEMENT_LEVEL_VALUES);

  if (data.fabricBehaviour) {
    checkArrayVocab("fabricBehaviour", data.fabricBehaviour, FABRIC_BEHAVIOUR_VALUES);
  }
  if (data.silhouetteCharacter) {
    checkArrayVocab("silhouetteCharacter", data.silhouetteCharacter, SILHOUETTE_CHARACTER_VALUES);
  }

  if (data.occasionFit) {
    for (const [k, v] of Object.entries(data.occasionFit)) {
      if (!(OCCASION_IDS as readonly string[]).includes(k)) {
        throw new StyleMeProfileValidationError(`Unknown occasion ID "${k}" in occasionFit`);
      }
      if (!(OCCASION_FIT_RATINGS as readonly string[]).includes(v)) {
        throw new StyleMeProfileValidationError(
          `Invalid rating "${v}" for occasion "${k}". Allowed: ${OCCASION_FIT_RATINGS.join(", ")}`,
        );
      }
    }
  }

  if (data.intentionPotentials) {
    for (const [k, v] of Object.entries(data.intentionPotentials)) {
      if (!(INTENTION_IDS as readonly string[]).includes(k)) {
        throw new StyleMeProfileValidationError(`Unknown intention ID "${k}" in intentionPotentials`);
      }
      if (!(INTENTION_RATINGS as readonly string[]).includes(v)) {
        throw new StyleMeProfileValidationError(
          `Invalid rating "${v}" for intention "${k}". Allowed: ${INTENTION_RATINGS.join(", ")}`,
        );
      }
    }
  }

  return data;
}

// ── Database operations ────────────────────────────────────────────────────────

/** Returns the StyleMe profile for a closet item, or null if not yet created. */
export async function getStyleMeProfile(itemId: string): Promise<StyleMeProfileRecord | null> {
  const row = await prisma.garmentStyleMeProfile.findUnique({
    where: { closetItemId: itemId },
  });
  if (!row) return null;
  return shapeRecord(row);
}

export type StyleMeProfileSaveError = { field: string; message: string };
export type StyleMeProfileSaveResult =
  | StyleMeProfileRecord
  | { errors: StyleMeProfileSaveError[] };

/** Upserts the StyleMe profile for a closet item with validated data.
 *  Returns { errors } on validation failure instead of throwing.
 *  Does NOT set reviewedAt/reviewedBy unless profileStatus changes to "approved". */
export async function saveStyleMeProfile(
  itemId: string,
  raw: StyleMeProfileInput | Record<string, unknown>,
  reviewedBy: string,
): Promise<StyleMeProfileSaveResult> {
  let data: StyleMeProfileInput;
  try {
    data = validateStyleMeProfileInput(raw as StyleMeProfileInput);
  } catch (err) {
    if (err instanceof StyleMeProfileValidationError) {
      return { errors: [{ field: "input", message: err.message }] };
    }
    throw err;
  }

  if (data.profileStatus === "approved") {
    const completenessErrors = checkApprovalCompleteness(data);
    if (completenessErrors.length > 0) {
      return { errors: completenessErrors };
    }
  }

  const now = new Date();
  const isApproving = data.profileStatus === "approved";

  const payload = {
    profileStatus: data.profileStatus ?? "in-review",
    exactSlot: data.exactSlot ?? null,
    outfitFunction: data.outfitFunction ?? null,
    styleFamilyPrimary: data.styleFamilyPrimary ?? null,
    styleFamilySecondary: data.styleFamilySecondary ?? null,
    dressRegister: data.dressRegister ?? null,
    construction: data.construction ?? null,
    fabricBehaviour: data.fabricBehaviour ?? [],
    silhouetteCharacter: data.silhouetteCharacter ?? [],
    visualWeight: data.visualWeight ?? null,
    stylingEffort: data.stylingEffort ?? null,
    layeringBehaviour: data.layeringBehaviour ?? null,
    waistComfort: data.waistComfort ?? null,
    statementLevel: data.statementLevel ?? null,
    occasionFit: data.occasionFit ?? null,
    intentionPotentials: data.intentionPotentials ?? null,
    naturalPairings: data.naturalPairings ?? null,
    intentionalMix: data.intentionalMix ?? null,
    avoidInStyleMe: data.avoidInStyleMe ?? null,
    specialNotes: data.specialNotes ?? null,
    ...(isApproving ? { reviewedAt: now, reviewedBy } : {}),
  };

  const row = await prisma.garmentStyleMeProfile.upsert({
    where: { closetItemId: itemId },
    create: { closetItemId: itemId, ...payload },
    update: payload,
  });

  return shapeRecord(row) as StyleMeProfileRecord;
}

// ── Shape helper ───────────────────────────────────────────────────────────────

function shapeRecord(row: {
  id: string;
  closetItemId: string;
  profileStatus: string;
  exactSlot: string | null;
  outfitFunction: string | null;
  styleFamilyPrimary: string | null;
  styleFamilySecondary: string | null;
  dressRegister: string | null;
  construction: string | null;
  fabricBehaviour: string[];
  silhouetteCharacter: string[];
  visualWeight: string | null;
  stylingEffort: string | null;
  layeringBehaviour: string | null;
  waistComfort: string | null;
  statementLevel: string | null;
  occasionFit: unknown;
  intentionPotentials: unknown;
  naturalPairings: string | null;
  intentionalMix: string | null;
  avoidInStyleMe: string | null;
  specialNotes: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StyleMeProfileRecord {
  return {
    ...row,
    profileStatus: (PROFILE_STATUS_VALUES as readonly string[]).includes(row.profileStatus)
      ? (row.profileStatus as ProfileStatus)
      : "unreviewed",
    occasionFit: row.occasionFit as Record<string, string> | null,
    intentionPotentials: row.intentionPotentials as Record<string, string> | null,
  };
}
