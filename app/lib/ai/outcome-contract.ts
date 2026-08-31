// app/lib/ai/outcome-contract.ts
// StyleMe Outcome Capture + Style Memory V1 — stable IDs, types, and validation.
// Pure module: no DB queries, no provider calls, no side effects.

// ── Stable ID sets ────────────────────────────────────────────────────────────

export const OUTCOME_STATUS_IDS = [
  "wore-it",
  "changed-something",
  "didnt-wear-it",
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUS_IDS)[number];

export const CHANGE_TYPE_IDS = [
  "shoes",
  "top",
  "bottom",
  "layer",
  "more-coverage",
  "less-formal",
  "more-comfortable",
  "different-colour",
  "different-fit",
  "other",
] as const;
export type ChangeType = (typeof CHANGE_TYPE_IDS)[number];

export const GOAL_OUTCOME_IDS = ["yes", "somewhat", "no"] as const;
export type GoalOutcome = (typeof GOAL_OUTCOME_IDS)[number];

export const DIRECTION_IDS = ["most-you", "fresh", "push-me"] as const;
export type DirectionId = (typeof DIRECTION_IDS)[number];

// ── Validation sets ───────────────────────────────────────────────────────────

const VALID_OUTCOME_STATUS = new Set<string>(OUTCOME_STATUS_IDS);
const VALID_CHANGE_TYPES   = new Set<string>(CHANGE_TYPE_IDS);
const VALID_GOAL_OUTCOMES  = new Set<string>(GOAL_OUTCOME_IDS);
const VALID_DIRECTIONS     = new Set<string>(DIRECTION_IDS);

export const CHANGE_TYPE_MAX     = 5;
export const OTHER_NOTE_MAX_CHARS = 280;

// ── Record types ──────────────────────────────────────────────────────────────

export interface StyleMeOutcomeInput {
  outcomeStatus:    OutcomeStatus;
  changeTypes:      ChangeType[];
  otherChangeNote:  string | null;
  goalOutcome:      GoalOutcome | null;
  selectedDirection: DirectionId | null;
}

export interface StyleMeOutcomeRecord {
  id:               string;
  customerId:       string;
  suggestionId:     string;
  sessionId:        string;
  outcomeStatus:    OutcomeStatus;
  changeTypes:      ChangeType[];
  otherChangeNote:  string | null;
  goalOutcome:      GoalOutcome | null;
  selectedDirection: DirectionId | null;
  submittedAt:      string;
  updatedAt:        string;
}

// Minimal shape returned to the client / loaded in result.tsx
export interface StyleMeOutcomeSummary {
  outcomeStatus:    OutcomeStatus;
  changeTypes:      ChangeType[];
  otherChangeNote:  string | null;
  goalOutcome:      GoalOutcome | null;
  selectedDirection: DirectionId | null;
}

// ── Validation result ─────────────────────────────────────────────────────────

export type ValidationOk    = { ok: true;  normalized: StyleMeOutcomeInput };
export type ValidationError = { ok: false; error: string; status: 400 };
export type ValidationResult = ValidationOk | ValidationError;

function err(msg: string): ValidationError {
  return { ok: false, error: msg, status: 400 };
}

// ── validateOutcomeInput ──────────────────────────────────────────────────────

/**
 * Validates and normalizes a raw outcome payload from a request body.
 * Applies server-side conditional rules — no client-supplied values are trusted.
 * Returns a typed error on any violation; normalized input on success.
 */
export function validateOutcomeInput(raw: Record<string, unknown>): ValidationResult {
  const {
    outcomeStatus,
    changeTypes:      rawChangeTypes,
    otherChangeNote:  rawNote,
    goalOutcome:      rawGoal,
    selectedDirection: rawDir,
  } = raw;

  // ── outcomeStatus ──
  if (typeof outcomeStatus !== "string" || !VALID_OUTCOME_STATUS.has(outcomeStatus)) {
    return err("invalid-outcome-status");
  }
  const status = outcomeStatus as OutcomeStatus;

  // ── changeTypes ──
  if (!Array.isArray(rawChangeTypes)) return err("invalid-change-types");
  for (const t of rawChangeTypes) {
    if (typeof t !== "string" || !VALID_CHANGE_TYPES.has(t)) {
      return err("invalid-change-type");
    }
  }
  // Deduplicate preserving first occurrence
  const deduped = [...new Set(rawChangeTypes as string[])] as ChangeType[];

  // ── goalOutcome ──
  let goalOutcome: GoalOutcome | null = null;
  if (rawGoal !== undefined && rawGoal !== null && rawGoal !== "") {
    if (typeof rawGoal !== "string" || !VALID_GOAL_OUTCOMES.has(rawGoal)) {
      return err("invalid-goal-outcome");
    }
    goalOutcome = rawGoal as GoalOutcome;
  }

  // ── selectedDirection ──
  let selectedDirection: DirectionId | null = null;
  if (rawDir !== undefined && rawDir !== null && rawDir !== "") {
    if (typeof rawDir !== "string" || !VALID_DIRECTIONS.has(rawDir)) {
      return err("invalid-selected-direction");
    }
    selectedDirection = rawDir as DirectionId;
  }

  // ── otherChangeNote ──
  let otherChangeNote: string | null = null;
  if (
    rawNote !== undefined &&
    rawNote !== null &&
    typeof rawNote === "string" &&
    rawNote.trim().length > 0
  ) {
    otherChangeNote = rawNote.trim().slice(0, OTHER_NOTE_MAX_CHARS);
  }

  // ── Apply conditional rules by outcomeStatus ──

  if (status === "wore-it") {
    return {
      ok: true,
      normalized: {
        outcomeStatus: "wore-it",
        changeTypes:   [],           // cleared for wore-it
        otherChangeNote: null,       // cleared for wore-it
        goalOutcome,
        selectedDirection,
      },
    };
  }

  if (status === "changed-something") {
    if (deduped.length === 0)             return err("changed-something-requires-change-type");
    if (deduped.length > CHANGE_TYPE_MAX) return err("too-many-change-types");

    const noteAllowed = deduped.includes("other");
    return {
      ok: true,
      normalized: {
        outcomeStatus:  "changed-something",
        changeTypes:    deduped,
        otherChangeNote: noteAllowed ? otherChangeNote : null,
        goalOutcome,
        selectedDirection,
      },
    };
  }

  // didnt-wear-it — clear all conditional fields
  return {
    ok: true,
    normalized: {
      outcomeStatus:   "didnt-wear-it",
      changeTypes:     [],
      otherChangeNote: null,
      goalOutcome:     null,         // cleared for didnt-wear-it
      selectedDirection,
    },
  };
}

// ── validateDirectionAgainstMetadata ─────────────────────────────────────────

/**
 * Validates selectedDirection against the actual saved resultDirections for a suggestion.
 * Returns an error string if invalid; null if valid.
 *
 * Rules:
 *  - null is always valid (no direction selected or legacy session)
 *  - A non-null direction must exist in the suggestion's stored resultDirections
 *  - Legacy suggestion (no resultDirections) only accepts null
 */
export function validateDirectionAgainstMetadata(
  selectedDirection: DirectionId | null,
  resultDirections: Array<{ label: string }> | undefined | null,
): string | null {
  if (selectedDirection === null) return null;

  if (!resultDirections || resultDirections.length === 0) {
    return "direction-not-in-suggestion";
  }

  const exists = resultDirections.some((d) => d.label === selectedDirection);
  if (!exists) return "direction-not-in-suggestion";
  return null;
}
