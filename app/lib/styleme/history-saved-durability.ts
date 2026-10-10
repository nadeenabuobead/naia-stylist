// app/lib/styleme/history-saved-durability.ts
//
// Saved-look durability for the unified StyleMe history loader
// (app/routes/style-me/_index.tsx). Card identity is per-SUGGESTION, not
// per-session: a session can have multiple OutfitSuggestions (rerolls),
// and SavedLook.fromSuggestionId names one specific suggestion. The loader
// caps normal history at the 20 most recent sessions, each showing its
// latest suggestion; SavedLook persistence has no such cap and is not
// necessarily the latest suggestion in its session. A saved suggestion
// that isn't the one a recent card already displays needs its own card —
// otherwise it is either badged onto the wrong (unsaved) suggestion, or
// never reachable at all regardless of the 20-session cap.
//
// Extracted here (rather than left inline in the route module) so these
// are testable without pulling in route-only imports — the same pattern
// already used for resolveLockedAnchorOutcome.

export type SessionRecord = {
  id: string; // session id — used for the result-page sessionId link param
  occasion: string | null;
  createdAt: string;
  outfitName: string | null;
  suggestionId: string | null; // the EXACT suggestion this card represents and links to
  saved: boolean; // true iff suggestionId is an actually-saved suggestion
  resolvedImages: string[]; // real per-item images for this exact result's collage
  extraCount: number; // pieces beyond what the collage shows
};

export type HistorySessionInput = {
  id: string;
  occasion: string | null;
  createdAt: Date; // session creation — ordering fallback only, when the session has no suggestion yet
  suggestions: Array<{
    id: string;
    outfitName: string | null;
    createdAt: Date;
    // Optional: callers that don't resolve collage imagery (existing tests,
    // other call sites) simply omit these and get prior behavior — a
    // completed look is assumed unless itemCount is explicitly 0.
    itemCount?: number;
    resolvedImages?: string[];
    extraCount?: number;
  }>;
};

export type SavedSuggestionInfo = { suggestionId: string; sessionId: string };

export type ExtraSuggestionInput = {
  suggestionId: string;
  outfitName: string | null;
  suggestionCreatedAt: Date; // the suggestion's own generation time — orders this card
  sessionId: string;
  sessionOccasion: string | null;
  itemCount?: number;
  resolvedImages?: string[];
  extraCount?: number;
};

/**
 * Resolves each SavedLook to its exact {suggestionId, sessionId} pair via
 * SavedLook.fromSuggestionId -> OutfitSuggestion. A fromSuggestionId with no
 * matching row in resolvedSuggestions (a stale reference to a deleted
 * suggestion — fromSuggestionId has no FK) is simply skipped — never throws.
 */
export function resolveSavedSuggestions(
  savedLooks: Array<{ fromSuggestionId: string | null }>,
  resolvedSuggestions: Array<{ id: string; sessionId: string }>,
): SavedSuggestionInfo[] {
  const sessionBySuggestion = new Map(resolvedSuggestions.map((s) => [s.id, s.sessionId]));
  const seen = new Set<string>();
  const result: SavedSuggestionInfo[] = [];
  for (const look of savedLooks) {
    if (!look.fromSuggestionId) continue;
    if (seen.has(look.fromSuggestionId)) continue;
    const sessionId = sessionBySuggestion.get(look.fromSuggestionId);
    if (!sessionId) continue; // stale reference — fails safe
    seen.add(look.fromSuggestionId);
    result.push({ suggestionId: look.fromSuggestionId, sessionId });
  }
  return result;
}

/**
 * A saved suggestion needs its own extra card only when it is not already
 * the suggestion a recent-20 card displays for that session — either
 * because the session isn't in the recent-20 window at all (displayed is
 * undefined), or because the session IS recent but its displayed (latest)
 * suggestion is a different one.
 */
export function selectExtraSavedSuggestions(
  savedSuggestions: SavedSuggestionInfo[],
  recentDisplayedSuggestionBySession: ReadonlyMap<string, string | null>,
): SavedSuggestionInfo[] {
  return savedSuggestions.filter(({ suggestionId, sessionId }) => {
    const displayed = recentDisplayedSuggestionBySession.get(sessionId);
    return displayed === undefined || displayed !== suggestionId;
  });
}

/**
 * Builds the single unified, deterministically-ordered history: one card
 * per recent-20 session (its latest suggestion, as before) plus one card
 * per extra saved suggestion that isn't already displayed by a recent
 * card. Each card's `saved` flag reflects whether its own exact
 * suggestionId is in savedSuggestionIds — never the session as a whole,
 * so two independently-saved suggestions from the same session each get
 * their own correctly-badged card, and neither collapses into the other.
 *
 * Ordering contract: each card orders by the real generation time of the
 * exact look it represents — the suggestion's own createdAt — not the
 * parent session's createdAt. A session's first suggestion and a later
 * reroll on that same session can be generated minutes or days apart;
 * ordering by session.createdAt would misrepresent when a rerolled (or
 * later-saved) look was actually made. Session.createdAt is used only as
 * a fallback for the rare case of a session with no suggestion yet
 * (mid-generation). Ties break by insertion order (Array.sort is stable);
 * cards with no suggestion sort using the session's own createdAt.
 */
export function buildUnifiedHistory(
  recentSessions: HistorySessionInput[],
  extraSuggestions: ExtraSuggestionInput[],
  savedSuggestionIds: ReadonlySet<string>,
): SessionRecord[] {
  // "Latest StyleMe"/history means completed looks: a session with no
  // suggestion at all, or a suggestion with zero items, never finished
  // generating a look and must not get a card — it's excluded, not shown
  // as an empty card. Undefined itemCount (callers that don't resolve
  // collage imagery) is treated as complete, preserving prior behavior
  // for those call sites.
  const recentCards: SessionRecord[] = recentSessions
    .map((s): SessionRecord | null => {
      const sugg = s.suggestions[0] ?? null;
      if (!sugg || sugg.itemCount === 0) return null;
      return {
        id: s.id,
        occasion: s.occasion,
        createdAt: sugg.createdAt.toISOString(),
        outfitName: sugg.outfitName,
        suggestionId: sugg.id,
        saved: savedSuggestionIds.has(sugg.id),
        resolvedImages: sugg.resolvedImages ?? [],
        extraCount: sugg.extraCount ?? 0,
      };
    })
    .filter((c): c is SessionRecord => c !== null);

  const extraCards: SessionRecord[] = extraSuggestions
    .filter((s) => s.itemCount !== 0)
    .map((s) => ({
      id: s.sessionId,
      occasion: s.sessionOccasion,
      createdAt: s.suggestionCreatedAt.toISOString(),
      outfitName: s.outfitName,
      suggestionId: s.suggestionId,
      saved: true, // extraSuggestions are, by construction, always saved suggestions
      resolvedImages: s.resolvedImages ?? [],
      extraCount: s.extraCount ?? 0,
    }));

  return [...recentCards, ...extraCards].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

/** Convenience: session id -> the suggestion id its recent-20 card displays (or null if no suggestion). */
export function buildDisplayedSuggestionMap(
  recentSessions: HistorySessionInput[],
): Map<string, string | null> {
  return new Map(recentSessions.map((s) => [s.id, s.suggestions[0]?.id ?? null]));
}

export type ResultSuggestionSelector =
  | { where: { id: string } }
  | { orderBy: { createdAt: "desc" }; take: 1 };

/**
 * Builds the Prisma sub-query passed to `StylingSession.findUnique(...).include.suggestions`
 * in the result-page loader (app/routes/style-me/result.tsx). This is deliberately a value
 * to be nested under that one `include`, never a standalone `prisma.outfitSuggestion.findUnique`
 * keyed by id alone — nesting it there means Prisma scopes the `id` filter to suggestions
 * belonging to the session already fetched (and ownership-checked) by sessionId, so a
 * suggestionId from a different session, or from another customer's session, can never
 * substitute in: it simply matches nothing under this session's relation and the suggestion
 * list comes back empty, same as any other miss.
 *
 * No requestedSuggestionId -> the exact pre-existing selector shape (latest suggestion only).
 */
export function resolveResultSuggestionSelector(
  requestedSuggestionId: string | null,
): ResultSuggestionSelector {
  return requestedSuggestionId
    ? { where: { id: requestedSuggestionId } }
    : { orderBy: { createdAt: "desc" }, take: 1 };
}
