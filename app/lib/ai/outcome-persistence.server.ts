// app/lib/ai/outcome-persistence.server.ts
// Style Memory V1 — DB operations for StyleMeOutcome.
//
// Security contract:
//   - All write operations require customerId that has already been ownership-verified
//     by the API route (caller's responsibility)
//   - sessionId is always server-derived (caller responsibility — never from client)
//   - No OnboardingProfile, dressingPreferences, or garmentRelationships are touched

import prisma from "../../db.server.js";
import type { StyleMeOutcomeInput, StyleMeOutcomeRecord, StyleMeOutcomeSummary } from "./outcome-contract.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ── Injectable function types ─────────────────────────────────────────────────

export type UpsertOutcomeFn = (
  customerId: string,
  suggestionId: string,
  sessionId: string,
  input: StyleMeOutcomeInput,
) => Promise<StyleMeOutcomeRecord>;

export type LoadOutcomeForSuggestionFn = (
  suggestionId: string,
  customerId: string,
) => Promise<StyleMeOutcomeSummary | null>;

// ── Row mapper ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRecord(r: any): StyleMeOutcomeRecord {
  return {
    id:               r.id,
    customerId:       r.customerId,
    suggestionId:     r.suggestionId,
    sessionId:        r.sessionId,
    outcomeStatus:    r.outcomeStatus,
    changeTypes:      Array.isArray(r.changeTypes) ? r.changeTypes : [],
    otherChangeNote:  r.otherChangeNote ?? null,
    goalOutcome:      r.goalOutcome     ?? null,
    selectedDirection: r.selectedDirection ?? null,
    whatWorked:        Array.isArray(r.whatWorked)        ? r.whatWorked        : [],
    whatFeltOff:       Array.isArray(r.whatFeltOff)       ? r.whatFeltOff       : [],
    didntWearReasons:  Array.isArray(r.didntWearReasons)  ? r.didntWearReasons  : [],
    reasonOtherNote:   r.reasonOtherNote  ?? null,
    submittedAt:      r.submittedAt instanceof Date ? r.submittedAt.toISOString() : r.submittedAt,
    updatedAt:        r.updatedAt   instanceof Date ? r.updatedAt.toISOString()   : r.updatedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSummary(r: any): StyleMeOutcomeSummary {
  return {
    outcomeStatus:    r.outcomeStatus,
    changeTypes:      Array.isArray(r.changeTypes) ? r.changeTypes : [],
    otherChangeNote:  r.otherChangeNote  ?? null,
    goalOutcome:      r.goalOutcome      ?? null,
    selectedDirection: r.selectedDirection ?? null,
    whatWorked:        Array.isArray(r.whatWorked)        ? r.whatWorked        : [],
    whatFeltOff:       Array.isArray(r.whatFeltOff)       ? r.whatFeltOff       : [],
    didntWearReasons:  Array.isArray(r.didntWearReasons)  ? r.didntWearReasons  : [],
    reasonOtherNote:   r.reasonOtherNote  ?? null,
  };
}

// ── Real Prisma implementations ───────────────────────────────────────────────

async function _upsertOutcome(
  customerId: string,
  suggestionId: string,
  sessionId: string,
  input: StyleMeOutcomeInput,
): Promise<StyleMeOutcomeRecord> {
  const payload = {
    customerId,
    suggestionId,
    sessionId,
    outcomeStatus:    input.outcomeStatus,
    changeTypes:      input.changeTypes,
    otherChangeNote:  input.otherChangeNote,
    goalOutcome:      input.goalOutcome,
    selectedDirection: input.selectedDirection,
    whatWorked:        input.whatWorked       ?? [],
    whatFeltOff:       input.whatFeltOff      ?? [],
    didntWearReasons:  input.didntWearReasons ?? [],
    reasonOtherNote:   input.reasonOtherNote  ?? null,
  };

  const r = await db.styleMeOutcome.upsert({
    where:  { suggestionId },
    create: payload,
    update: {
      outcomeStatus:    input.outcomeStatus,
      changeTypes:      input.changeTypes,
      otherChangeNote:  input.otherChangeNote,
      goalOutcome:      input.goalOutcome,
      selectedDirection: input.selectedDirection,
      whatWorked:        input.whatWorked       ?? [],
      whatFeltOff:       input.whatFeltOff      ?? [],
      didntWearReasons:  input.didntWearReasons ?? [],
      reasonOtherNote:   input.reasonOtherNote  ?? null,
    },
  });
  return toRecord(r);
}

async function _loadOutcomeForSuggestion(
  suggestionId: string,
  customerId: string,
): Promise<StyleMeOutcomeSummary | null> {
  const r = await db.styleMeOutcome.findUnique({
    where: { suggestionId },
  });
  if (!r) return null;
  // Guard: ensure the outcome belongs to the requesting customer
  if (r.customerId !== customerId) return null;
  return toSummary(r);
}

// ── Public operations ─────────────────────────────────────────────────────────

export async function upsertOutcome(
  customerId: string,
  suggestionId: string,
  sessionId: string,
  input: StyleMeOutcomeInput,
  _upsertFn: UpsertOutcomeFn = _upsertOutcome,
): Promise<StyleMeOutcomeRecord> {
  return _upsertFn(customerId, suggestionId, sessionId, input);
}

export async function loadOutcomeForSuggestion(
  suggestionId: string,
  customerId: string,
  _loadFn: LoadOutcomeForSuggestionFn = _loadOutcomeForSuggestion,
): Promise<StyleMeOutcomeSummary | null> {
  return _loadFn(suggestionId, customerId);
}
