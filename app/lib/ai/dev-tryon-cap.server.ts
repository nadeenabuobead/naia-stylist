// app/lib/ai/dev-tryon-cap.server.ts
// Development-only persistent call cap for Phase 4A5 FASHN testing.
// Backed by .dev-tryon-cap.json at project root — survives server restart and hot reload.
//
// Usage contract:
//   claimDevCallSlot()           — call BEFORE POST /v1/run; returns false if cap exhausted.
//   updateDevCallEntry()         — call after the FASHN result is known (ok / fail / timeout).
//   getExistingPredictionId()    — returns an in-flight predictionId so polling can resume
//                                  without consuming a new slot.
//
// All exported functions accept an optional _capFile for DI in tests.

import fs from "node:fs";
import path from "node:path";

export const DEV_MAX_NEW_CALLS = 10;

const DEFAULT_CAP_FILE = path.join(process.cwd(), ".dev-tryon-cap.json");

export type CapEntryOutcome = "completed" | "failed" | "timeout";

export interface CapEntry {
  handle: string;
  claimedAt: string;          // ISO 8601 — when the slot was claimed
  predictionId?: string;      // populated immediately after POST /v1/run succeeds
  outcome?: CapEntryOutcome;  // populated once the call reaches a terminal state
}

export interface CapState {
  newCalls: number;           // slots claimed (= real FASHN submissions attempted)
  entries: CapEntry[];
}

export function readCapState(_capFile: string = DEFAULT_CAP_FILE): CapState {
  try {
    const raw = fs.readFileSync(_capFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).newCalls === "number"
    ) {
      return parsed as CapState;
    }
  } catch {
    // file missing, corrupt, or unreadable — start fresh
  }
  return { newCalls: 0, entries: [] };
}

function writeCapState(state: CapState, _capFile: string = DEFAULT_CAP_FILE): void {
  fs.writeFileSync(_capFile, JSON.stringify(state, null, 2), "utf8");
}

export function getDevCapState(
  _capFile: string = DEFAULT_CAP_FILE,
): { newCalls: number; maxCalls: number; remaining: number } {
  const state = readCapState(_capFile);
  return {
    newCalls: state.newCalls,
    maxCalls: DEV_MAX_NEW_CALLS,
    remaining: Math.max(0, DEV_MAX_NEW_CALLS - state.newCalls),
  };
}

// Call immediately before POST /v1/run.
// Returns { allowed: false } if cap exhausted — do not proceed to FASHN.
// Returns { allowed: true, entryIndex } and atomically increments the counter.
// Idempotent: if an open entry (no outcome) already exists for this handle,
// returns it without creating a new one — prevents double-counting after a
// pre-flight slot claim when the actual harness submission follows.
export function claimDevCallSlot(
  handle: string,
  _capFile: string = DEFAULT_CAP_FILE,
): { allowed: true; entryIndex: number } | { allowed: false } {
  const state = readCapState(_capFile);
  if (state.newCalls >= DEV_MAX_NEW_CALLS) {
    return { allowed: false };
  }
  // Reuse an open entry for the same handle to avoid double-counting.
  for (let i = state.entries.length - 1; i >= 0; i--) {
    if (state.entries[i].handle === handle && !state.entries[i].outcome) {
      return { allowed: true, entryIndex: i };
    }
  }
  const entry: CapEntry = { handle, claimedAt: new Date().toISOString() };
  state.newCalls++;
  state.entries.push(entry);
  writeCapState(state, _capFile);
  return { allowed: true, entryIndex: state.entries.length - 1 };
}

// Persists the predictionId or terminal outcome for the most recent open entry for this handle.
// Call with { predictionId } immediately after POST /v1/run returns an ID.
// Call with { outcome } when the call reaches a terminal state.
export function updateDevCallEntry(
  handle: string,
  update: { predictionId?: string; outcome?: CapEntryOutcome },
  _capFile: string = DEFAULT_CAP_FILE,
): void {
  const state = readCapState(_capFile);
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i];
    if (entry.handle === handle && !entry.outcome) {
      if (update.predictionId != null) entry.predictionId = update.predictionId;
      if (update.outcome != null) entry.outcome = update.outcome;
      writeCapState(state, _capFile);
      return;
    }
  }
}

// Returns the predictionId from the most recent in-flight submission for this handle.
// "In-flight" = predictionId is set AND no terminal outcome yet.
// Callers can pass this to runFashnTryOn({ existingPredictionId }) to resume polling
// without claiming a new slot.
export function getExistingPredictionId(
  handle: string,
  _capFile: string = DEFAULT_CAP_FILE,
): string | null {
  const state = readCapState(_capFile);
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i];
    if (entry.handle === handle && entry.predictionId && !entry.outcome) {
      return entry.predictionId;
    }
  }
  return null;
}
