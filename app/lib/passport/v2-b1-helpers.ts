// app/lib/passport/v2-b1-helpers.ts
// Pure, DB-free helpers for the V2-B1 Passport save contract.
// Imported by api.save-style-profile.jsx and v2-b1-helpers.test.ts.

// ── fitPreferences → new-field mappings ────────────────────────────────────────
// "coverage" and "simple" have no approved V2-B1 mapping.

export const FIT_TO_SILHOUETTE: Readonly<Record<string, string>> = {
  "defined-waist": "defined-waist",
  "relaxed-fits":  "relaxed",
  "oversized":     "oversized",
  "flowy":         "flowing",
  "fitted":        "fitted",
};

export const FIT_TO_STRUCTURE: Readonly<Record<string, string>> = {
  "structured": "sharp-tailored",
};

/** Maximum lifestyle IDs permitted on an explicit Passport save. */
export const LIFESTYLE_MAX = 3;

/** Maximum character length for typicalDay (after trim). */
export const TYPICAL_DAY_MAX = 500;

/**
 * Returns true when a submitted lifestyle array is within the V2-B1 limit.
 * Apply only to submitted values — never to values already stored in the DB.
 */
export function isLifestyleCountValid(ids: string[]): boolean {
  return ids.length <= LIFESTYLE_MAX;
}

/**
 * Resolves favourite/avoid colour conflict: avoid wins.
 * Any colour ID that appears in both arrays is removed from favourites.
 * Non-conflicting values are preserved in their original order.
 */
export function resolveColourConflict(
  favorites: readonly string[],
  avoids: readonly string[],
): string[] {
  const avoidSet = new Set(avoids);
  return favorites.filter((id) => !avoidSet.has(id));
}

/**
 * Derives new Passport V2-B1 field values from fitPreferences (idempotent additive).
 *
 * Rules:
 * - When a target field already has a value (non-empty array or non-null string),
 *   it is returned unchanged — an explicitly saved value is never overwritten.
 * - When a target field is empty/null, derived values are built from the mappings.
 * - "coverage" and "simple" produce no derived value in either target field.
 * - Derived silhouette values are deduplicated and insertion-ordered.
 */
export function deriveFitMigration(
  fitPreferences: string[],
  existingSilhouette: string[],
  existingStructure: string | null,
): { silhouette: string[]; structure: string | null } {
  const silhouette =
    existingSilhouette.length > 0
      ? existingSilhouette
      : [
          ...new Set(
            fitPreferences
              .map((fp) => FIT_TO_SILHOUETTE[fp])
              .filter((v): v is string => v !== undefined),
          ),
        ];

  const structure =
    existingStructure !== null
      ? existingStructure
      : (fitPreferences
          .map((fp) => FIT_TO_STRUCTURE[fp])
          .find((v): v is string => v !== undefined) ?? null);

  return { silhouette, structure };
}

/**
 * Normalizes a typicalDay raw value for storage:
 * - trims whitespace;
 * - null / undefined / blank → null.
 * Length validation (> TYPICAL_DAY_MAX) is the caller's responsibility.
 */
export function normalizeTypicalDay(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  return trimmed !== "" ? trimmed : null;
}
