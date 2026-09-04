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

// ── Reason ID sets (QA redesign — additive) ───────────────────────────────────

export const WHAT_WORKED_IDS = [
  "felt-like-me",
  "felt-confident",
  "comfortable",
  "got-compliments",
  "occasion-right",
  "other",
] as const;
export type WhatWorkedId = (typeof WHAT_WORKED_IDS)[number];

export const WHAT_FELT_OFF_IDS = [
  "didnt-feel-like-me",
  "uncomfortable",
  "fit-issue",
  "wrong-colour",
  "too-formal",
  "too-casual",
  "other",
] as const;
export type WhatFeltOffId = (typeof WHAT_FELT_OFF_IDS)[number];

export const DIDNT_WEAR_REASON_IDS = [
  "weather",
  "plans-changed",
  "comfort-concern",
  "style-mood-changed",
  "not-ready",
  "other",
] as const;
export type DidntWearReasonId = (typeof DIDNT_WEAR_REASON_IDS)[number];

// ── Validation sets ───────────────────────────────────────────────────────────

const VALID_OUTCOME_STATUS    = new Set<string>(OUTCOME_STATUS_IDS);
const VALID_CHANGE_TYPES      = new Set<string>(CHANGE_TYPE_IDS);
const VALID_GOAL_OUTCOMES     = new Set<string>(GOAL_OUTCOME_IDS);
const VALID_DIRECTIONS        = new Set<string>(DIRECTION_IDS);
const VALID_WHAT_WORKED       = new Set<string>(WHAT_WORKED_IDS);
const VALID_WHAT_FELT_OFF     = new Set<string>(WHAT_FELT_OFF_IDS);
const VALID_DIDNT_WEAR_REASON = new Set<string>(DIDNT_WEAR_REASON_IDS);

export const CHANGE_TYPE_MAX       = 5;
export const OTHER_NOTE_MAX_CHARS  = 280;
export const REASON_ARRAY_MAX      = 3;
export const REASON_OTHER_NOTE_MAX = 280;

// ── Record types ──────────────────────────────────────────────────────────────

export interface StyleMeOutcomeInput {
  outcomeStatus:    OutcomeStatus;
  changeTypes:      ChangeType[];
  otherChangeNote:  string | null;
  goalOutcome:      GoalOutcome | null;
  selectedDirection: DirectionId | null;
  // QA redesign fields — optional for backward compat with existing tests
  whatWorked?:        string[];
  whatFeltOff?:       string[];
  didntWearReasons?:  string[];
  reasonOtherNote?:   string | null;
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
  whatWorked:        string[];
  whatFeltOff:       string[];
  didntWearReasons:  string[];
  reasonOtherNote:   string | null;
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
  whatWorked:        string[];
  whatFeltOff:       string[];
  didntWearReasons:  string[];
  reasonOtherNote:   string | null;
}

// Normalized output type — all fields are guaranteed present after validation
export interface StyleMeOutcomeNormalized {
  outcomeStatus:    OutcomeStatus;
  changeTypes:      ChangeType[];
  otherChangeNote:  string | null;
  goalOutcome:      GoalOutcome | null;
  selectedDirection: DirectionId | null;
  whatWorked:        string[];
  whatFeltOff:       string[];
  didntWearReasons:  string[];
  reasonOtherNote:   string | null;
}

// ── Validation result ─────────────────────────────────────────────────────────

export type ValidationOk    = { ok: true;  normalized: StyleMeOutcomeNormalized };
export type ValidationError = { ok: false; error: string; status: 400 };
export type ValidationResult = ValidationOk | ValidationError;

function err(msg: string): ValidationError {
  return { ok: false, error: msg, status: 400 };
}

// ── Reason array helper ───────────────────────────────────────────────────────

function parseReasonArray(
  raw: unknown,
  validSet: Set<string>,
  errorPrefix: string,
): { ok: true; deduped: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, deduped: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `invalid-${errorPrefix}` };
  for (const t of raw) {
    if (typeof t !== "string" || !validSet.has(t)) {
      return { ok: false, error: `invalid-${errorPrefix}-id` };
    }
  }
  const deduped = [...new Set(raw as string[])];
  if (deduped.length > REASON_ARRAY_MAX) {
    return { ok: false, error: `too-many-${errorPrefix}` };
  }
  return { ok: true, deduped };
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
    changeTypes:       rawChangeTypes,
    otherChangeNote:   rawNote,
    goalOutcome:       rawGoal,
    selectedDirection: rawDir,
    whatWorked:        rawWhatWorked,
    whatFeltOff:       rawWhatFeltOff,
    didntWearReasons:  rawDidntWear,
    reasonOtherNote:   rawReasonNote,
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

  // ── otherChangeNote (for "other" in changeTypes) ──
  let otherChangeNote: string | null = null;
  if (
    rawNote !== undefined &&
    rawNote !== null &&
    typeof rawNote === "string" &&
    rawNote.trim().length > 0
  ) {
    otherChangeNote = rawNote.trim().slice(0, OTHER_NOTE_MAX_CHARS);
  }

  // ── whatWorked / whatFeltOff / didntWearReasons ──
  const wwResult = parseReasonArray(rawWhatWorked, VALID_WHAT_WORKED, "what-worked");
  if (!wwResult.ok) return err(wwResult.error);

  const wfoResult = parseReasonArray(rawWhatFeltOff, VALID_WHAT_FELT_OFF, "what-felt-off");
  if (!wfoResult.ok) return err(wfoResult.error);

  const dwrResult = parseReasonArray(rawDidntWear, VALID_DIDNT_WEAR_REASON, "didnt-wear-reason");
  if (!dwrResult.ok) return err(dwrResult.error);

  // ── reasonOtherNote (for "other" in whatWorked / whatFeltOff / didntWearReasons) ──
  let reasonOtherNote: string | null = null;
  if (
    rawReasonNote !== undefined &&
    rawReasonNote !== null &&
    typeof rawReasonNote === "string" &&
    rawReasonNote.trim().length > 0
  ) {
    reasonOtherNote = rawReasonNote.trim().slice(0, REASON_OTHER_NOTE_MAX);
  }

  // ── Apply conditional rules by outcomeStatus ──

  if (status === "wore-it") {
    // Clear changeTypes/otherChangeNote and didntWearReasons
    // whatWorked: only when goalOutcome === "yes"
    // whatFeltOff: only when goalOutcome is "somewhat" or "no"
    const workedActive = goalOutcome === "yes";
    const feltOffActive = goalOutcome === "somewhat" || goalOutcome === "no";
    const activeHasOther =
      (workedActive && wwResult.deduped.includes("other")) ||
      (feltOffActive && wfoResult.deduped.includes("other"));
    return {
      ok: true,
      normalized: {
        outcomeStatus:    "wore-it",
        changeTypes:      [],
        otherChangeNote:  null,
        goalOutcome,
        selectedDirection,
        whatWorked:       workedActive  ? wwResult.deduped  : [],
        whatFeltOff:      feltOffActive ? wfoResult.deduped : [],
        didntWearReasons: [],
        reasonOtherNote:  activeHasOther ? reasonOtherNote : null,
      },
    };
  }

  if (status === "changed-something") {
    if (deduped.length === 0)             return err("changed-something-requires-change-type");
    if (deduped.length > CHANGE_TYPE_MAX) return err("too-many-change-types");

    const noteAllowed = deduped.includes("other");
    const workedActive  = goalOutcome === "yes";
    const feltOffActive = goalOutcome === "somewhat" || goalOutcome === "no";
    const activeHasOther =
      (workedActive && wwResult.deduped.includes("other")) ||
      (feltOffActive && wfoResult.deduped.includes("other"));
    return {
      ok: true,
      normalized: {
        outcomeStatus:    "changed-something",
        changeTypes:      deduped,
        otherChangeNote:  noteAllowed ? otherChangeNote : null,
        goalOutcome,
        selectedDirection,
        whatWorked:       workedActive  ? wwResult.deduped  : [],
        whatFeltOff:      feltOffActive ? wfoResult.deduped : [],
        didntWearReasons: [],
        reasonOtherNote:  activeHasOther ? reasonOtherNote : null,
      },
    };
  }

  // didnt-wear-it — clear goalOutcome, changeTypes, whatWorked, whatFeltOff
  if (dwrResult.deduped.length === 0) return err("didnt-wear-it-requires-reason");

  const dwrHasOther = dwrResult.deduped.includes("other");
  return {
    ok: true,
    normalized: {
      outcomeStatus:    "didnt-wear-it",
      changeTypes:      [],
      otherChangeNote:  null,
      goalOutcome:      null,
      selectedDirection,
      whatWorked:       [],
      whatFeltOff:      [],
      didntWearReasons: dwrResult.deduped,
      reasonOtherNote:  dwrHasOther ? reasonOtherNote : null,
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
