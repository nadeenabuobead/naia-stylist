// app/lib/styleme/history-saved-durability.ts
//
// Saved-look durability for the unified StyleMe history loader
// (app/routes/style-me/_index.tsx). The loader caps normal history at the
// 20 most recent sessions; SavedLook persistence itself has no such cap —
// a look explicitly saved from a session outside the recent 20 remains in
// the database but was unreachable from the customer UI. These pure
// functions resolve which older sessions must be surfaced anyway, and
// merge them deterministically into one unified list. Extracted here
// (rather than left inline in the route module) so they're testable
// without pulling in route-only imports (CSS, etc.) that break under a
// plain test runner — the same pattern already used for
// resolveLockedAnchorOutcome.

export type SessionRecord = {
  id: string;
  occasion: string | null;
  createdAt: string;
  outfitName: string | null;
  suggestionId: string | null;
  saved: boolean;
};

export type HistorySessionInput = {
  id: string;
  occasion: string | null;
  createdAt: Date;
  suggestions: Array<{ id: string; outfitName: string | null }>;
};

/**
 * Resolves which StylingSession ids have at least one SavedLook pointing at
 * them, via the SavedLook -> OutfitSuggestion -> StylingSession chain.
 * A SavedLook whose fromSuggestionId has no matching row in resolvedSuggestions
 * (a stale reference to a deleted suggestion — fromSuggestionId has no FK) is
 * simply skipped — never throws.
 */
export function resolveSavedSessionIds(
  savedLooks: Array<{ fromSuggestionId: string | null }>,
  resolvedSuggestions: Array<{ id: string; sessionId: string }>,
): Set<string> {
  const suggestionToSession = new Map(resolvedSuggestions.map((s) => [s.id, s.sessionId]));
  const result = new Set<string>();
  for (const look of savedLooks) {
    if (!look.fromSuggestionId) continue;
    const sessionId = suggestionToSession.get(look.fromSuggestionId);
    if (sessionId) result.add(sessionId);
  }
  return result;
}

/** The saved sessions not already present in the recent-20 window — never includes an unsaved session. */
export function selectExtraSavedSessionIds(
  recentSessionIds: ReadonlySet<string>,
  savedSessionIds: ReadonlySet<string>,
): string[] {
  return [...savedSessionIds].filter((id) => !recentSessionIds.has(id));
}

/**
 * Merges the recent-20 sessions with any older explicitly-saved sessions into
 * one deterministically-ordered list (createdAt desc), annotating each with
 * its saved state. recentSessions and extraSavedSessions are assumed disjoint
 * (selectExtraSavedSessionIds already excludes overlap) — this function does
 * not re-check for duplicates, it only orders and annotates.
 */
export function mergeHistoryWithSavedSessions(
  recentSessions: HistorySessionInput[],
  extraSavedSessions: HistorySessionInput[],
  savedSessionIds: ReadonlySet<string>,
): SessionRecord[] {
  const toRecord = (s: HistorySessionInput): SessionRecord => {
    const sugg = s.suggestions[0] ?? null;
    return {
      id: s.id,
      occasion: s.occasion,
      createdAt: s.createdAt.toISOString(),
      outfitName: sugg?.outfitName ?? null,
      suggestionId: sugg?.id ?? null,
      saved: savedSessionIds.has(s.id),
    };
  };
  return [...recentSessions, ...extraSavedSessions]
    .map(toRecord)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
