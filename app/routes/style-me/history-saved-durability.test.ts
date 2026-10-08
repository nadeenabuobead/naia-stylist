// app/routes/style-me/history-saved-durability.test.ts
//
// Saved-look durability closeout, suggestion-level correction. A session
// can have multiple OutfitSuggestions (rerolls), and SavedLook.fromSuggestionId
// names one specific suggestion — not "this session in general". The first
// pass of this fix (190fbdb) tracked saved state per-session, which could:
//   - badge the wrong (unsaved) suggestion as saved, when an EARLIER
//     suggestion in the same session was the one actually saved;
//   - leave the actually-saved suggestion unreachable even when its session
//     was correctly surfaced, because the "View Look" link always resolved
//     to the session's latest suggestion.
// These tests exercise the real suggestion-aware resolution/merge logic the
// loader calls — no live database needed, matching this codebase's
// established pattern of testing loaders via their extracted pure functions.
//
// Card identity contract: a card is identified by suggestionId, not sessionId.
// Two cards from the same session are allowed only when they represent two
// different suggestions — never the same suggestionId twice (no duplicate
// look/suggestion card), and never collapsed into one session-level boolean.
//
// Ordering contract: each card orders by the real generation time of the
// exact look it represents (the suggestion's own createdAt), falling back to
// session.createdAt only when a session has no suggestion yet. A suggestion
// generated well after its session started (a reroll, or a save made days
// later) must not be misplaced in the list by its parent session's age.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSavedSuggestions,
  selectExtraSavedSuggestions,
  buildUnifiedHistory,
  buildDisplayedSuggestionMap,
  resolveResultSuggestionSelector,
  type HistorySessionInput,
  type ExtraSuggestionInput,
} from "../../lib/styleme/history-saved-durability";

function session(
  id: string,
  daysAgo: number,
  suggestions: Array<{ id: string; outfitName: string | null; createdAtDaysAgo?: number }>,
): HistorySessionInput {
  return {
    id,
    occasion: "everyday",
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    suggestions: suggestions.map((s) => ({
      id: s.id,
      outfitName: s.outfitName,
      createdAt: new Date(Date.now() - (s.createdAtDaysAgo ?? daysAgo) * 86_400_000),
    })),
  };
}

function extraInput(
  suggestionId: string,
  outfitName: string | null,
  sessionId: string,
  sessionOccasion: string | null,
  suggestionCreatedAtDaysAgo: number,
): ExtraSuggestionInput {
  return {
    suggestionId,
    outfitName,
    suggestionCreatedAt: new Date(Date.now() - suggestionCreatedAtDaysAgo * 86_400_000),
    sessionId,
    sessionOccasion,
  };
}

const RECENT_20 = Array.from({ length: 20 }, (_, i) =>
  session(`recent-${i + 1}`, i + 1, [{ id: `sugg-recent-${i + 1}`, outfitName: `Look ${i + 1}` }]),
);
const RECENT_IDS = new Set(RECENT_20.map((s) => s.id));

describe("§SAVED-IDENTITY — the real bug: saved state must track the exact suggestion, not the session", () => {
  // Session X has two suggestions over time: A (older, saved) and B (newer reroll, unsaved).
  // The history card for session X always displays its LATEST suggestion — B.
  const sessionX = session("session-x", 2, [{ id: "sugg-B", outfitName: "Look B" }]); // displayed = B
  const savedLooks = [{ fromSuggestionId: "sugg-A" }]; // A is saved, not B
  const resolvedSuggestions = [{ id: "sugg-A", sessionId: "session-x" }];

  it("1. session with saved A + newer unsaved B: B must NOT receive A's saved badge", () => {
    const savedSuggestions = resolveSavedSuggestions(savedLooks, resolvedSuggestions);
    const savedSuggestionIds = new Set(savedSuggestions.map((s) => s.suggestionId));
    const history = buildUnifiedHistory([sessionX], [], savedSuggestionIds);
    const cardForX = history.find((r) => r.id === "session-x" && r.suggestionId === "sugg-B");
    assert.ok(cardForX, "card for session-x displaying B exists");
    assert.equal(cardForX!.saved, false, "B is not saved — must not be falsely badged");
  });

  it("the actual saved suggestion A gets its own separate, correctly-badged card", () => {
    const savedSuggestions = resolveSavedSuggestions(savedLooks, resolvedSuggestions);
    const savedSuggestionIds = new Set(savedSuggestions.map((s) => s.suggestionId));
    const displayedMap = buildDisplayedSuggestionMap([sessionX]);
    const extra = selectExtraSavedSuggestions(savedSuggestions, displayedMap);
    assert.deepEqual(extra, [{ suggestionId: "sugg-A", sessionId: "session-x" }], "A needs its own extra card — it isn't what session-x's recent card displays");

    const extraInputs: ExtraSuggestionInput[] = [extraInput("sugg-A", "Look A", "session-x", "everyday", 2)];
    const history = buildUnifiedHistory([sessionX], extraInputs, savedSuggestionIds);
    const cardForA = history.find((r) => r.suggestionId === "sugg-A");
    assert.ok(cardForA, "A has its own card");
    assert.equal(cardForA!.saved, true, "A is visibly marked saved");
    assert.equal(cardForA!.outfitName, "Look A", "A's own content, not B's");
  });
});

describe("§SAVED-IDENTITY — required behaviors", () => {
  it("2. session with unsaved A + newer saved B: B is correctly badged on the normal recent card, no extra card needed", () => {
    const sessionX = session("session-x", 1, [{ id: "sugg-B", outfitName: "Look B" }]); // displayed = B
    const savedSuggestions = resolveSavedSuggestions([{ fromSuggestionId: "sugg-B" }], [{ id: "sugg-B", sessionId: "session-x" }]);
    const savedSuggestionIds = new Set(savedSuggestions.map((s) => s.suggestionId));
    const displayedMap = buildDisplayedSuggestionMap([sessionX]);
    const extra = selectExtraSavedSuggestions(savedSuggestions, displayedMap);
    assert.deepEqual(extra, [], "B is already displayed by the recent card — no extra card needed");

    const history = buildUnifiedHistory([sessionX], [], savedSuggestionIds);
    assert.equal(history.length, 1);
    assert.equal(history[0].saved, true, "B correctly badged on the one card that exists");
  });

  it("3. A and B both saved: two distinct, independently-badged cards for the same session (no duplicate look/suggestion card)", () => {
    const sessionX = session("session-x", 1, [{ id: "sugg-B", outfitName: "Look B" }]); // displayed = B
    const savedSuggestions = resolveSavedSuggestions(
      [{ fromSuggestionId: "sugg-A" }, { fromSuggestionId: "sugg-B" }],
      [{ id: "sugg-A", sessionId: "session-x" }, { id: "sugg-B", sessionId: "session-x" }],
    );
    const savedSuggestionIds = new Set(savedSuggestions.map((s) => s.suggestionId));
    const displayedMap = buildDisplayedSuggestionMap([sessionX]);
    const extra = selectExtraSavedSuggestions(savedSuggestions, displayedMap);
    assert.deepEqual(extra.map((e) => e.suggestionId), ["sugg-A"], "only A needs an extra card — B is already displayed");

    const extraInputs: ExtraSuggestionInput[] = [extraInput("sugg-A", "Look A", "session-x", "everyday", 3)];
    const history = buildUnifiedHistory([sessionX], extraInputs, savedSuggestionIds);
    assert.equal(history.length, 2, "two independent cards — A and B do not collapse into one session-level boolean");
    const suggestionIds = history.map((r) => r.suggestionId);
    assert.equal(new Set(suggestionIds).size, suggestionIds.length, "no duplicate suggestionId across cards");
    const bySuggestion = new Map(history.map((r) => [r.suggestionId, r]));
    assert.equal(bySuggestion.get("sugg-A")!.saved, true);
    assert.equal(bySuggestion.get("sugg-B")!.saved, true);
  });

  it("4. an old saved suggestion outside the recent 20 gets its own extra card", () => {
    const savedSuggestions = resolveSavedSuggestions(
      [{ fromSuggestionId: "sugg-old-25" }],
      [{ id: "sugg-old-25", sessionId: "older-25" }],
    );
    const savedSuggestionIds = new Set(savedSuggestions.map((s) => s.suggestionId));
    const displayedMap = buildDisplayedSuggestionMap(RECENT_20); // older-25 not in here at all
    const extra = selectExtraSavedSuggestions(savedSuggestions, displayedMap);
    assert.deepEqual(extra, [{ suggestionId: "sugg-old-25", sessionId: "older-25" }]);

    const extraInputs: ExtraSuggestionInput[] = [extraInput("sugg-old-25", "Old Look", "older-25", "dinner", 30)];
    const history = buildUnifiedHistory(RECENT_20, extraInputs, savedSuggestionIds);
    assert.equal(history.length, 21);
    assert.ok(history.some((r) => r.suggestionId === "sugg-old-25" && r.saved === true));
  });

  it("5. recent session's displayed latest suggestion must not get a different suggestion's bookmark badge", () => {
    // Same as scenario 1, restated as the explicit non-contamination check.
    const sessionX = session("session-x", 1, [{ id: "sugg-B", outfitName: "Look B" }]);
    const savedSuggestions = resolveSavedSuggestions([{ fromSuggestionId: "sugg-A" }], [{ id: "sugg-A", sessionId: "session-x" }]);
    const savedSuggestionIds = new Set(savedSuggestions.map((s) => s.suggestionId));
    const history = buildUnifiedHistory([sessionX], [], savedSuggestionIds);
    assert.equal(history[0].suggestionId, "sugg-B");
    assert.equal(history[0].saved, false, "B's own card must read saved=false — A's save does not leak onto it");
  });

  it("6. unsaving A removes only A's special visibility — B (if present and unsaved) is unaffected", () => {
    const sessionX = session("session-x", 1, [{ id: "sugg-B", outfitName: "Look B" }]);
    // Before unsaving: A is saved and gets its own extra card.
    const savedBefore = resolveSavedSuggestions([{ fromSuggestionId: "sugg-A" }], [{ id: "sugg-A", sessionId: "session-x" }]);
    const displayedMap = buildDisplayedSuggestionMap([sessionX]);
    const extraBefore = selectExtraSavedSuggestions(savedBefore, displayedMap);
    assert.deepEqual(extraBefore, [{ suggestionId: "sugg-A", sessionId: "session-x" }]);

    // After unsaving: A's SavedLook row no longer exists.
    const savedAfter = resolveSavedSuggestions([], []);
    const extraAfter = selectExtraSavedSuggestions(savedAfter, displayedMap);
    assert.deepEqual(extraAfter, [], "A no longer requested once unsaved");
    const historyAfter = buildUnifiedHistory([sessionX], [], new Set(savedAfter.map((s) => s.suggestionId)));
    assert.equal(historyAfter.length, 1, "only B's normal card remains — A's extra card is gone");
    assert.equal(historyAfter[0].saved, false, "B was never saved — unaffected by A's unsaving");
  });

  it("7. overlap (same suggestion via recent + saved paths) dedupes once, by actual displayed suggestion — not merely by session id", () => {
    // session-x's recent card displays sugg-B. sugg-B is ALSO the saved suggestion.
    // It must not be fetched/added again as an "extra" — selectExtraSavedSuggestions
    // compares suggestion identity, not just session identity.
    const sessionX = session("session-x", 1, [{ id: "sugg-B", outfitName: "Look B" }]);
    const savedSuggestions = resolveSavedSuggestions([{ fromSuggestionId: "sugg-B" }], [{ id: "sugg-B", sessionId: "session-x" }]);
    const displayedMap = buildDisplayedSuggestionMap([sessionX]);
    const extra = selectExtraSavedSuggestions(savedSuggestions, displayedMap);
    assert.deepEqual(extra, [], "sugg-B is already the displayed suggestion — correct dedupe by suggestion id");
  });

  it("8. a stale SavedLook referencing a deleted suggestion is ignored safely — no crash, no phantom card", () => {
    const savedLooks = [
      { fromSuggestionId: "sugg-deleted" }, // no longer exists
      { fromSuggestionId: "sugg-A" }, // still resolves
    ];
    const resolvedSuggestions = [{ id: "sugg-A", sessionId: "session-x" }]; // deleted one absent, as Prisma would return
    const savedSuggestions = resolveSavedSuggestions(savedLooks, resolvedSuggestions);
    assert.deepEqual(savedSuggestions, [{ suggestionId: "sugg-A", sessionId: "session-x" }], "stale reference silently skipped, valid one still resolves");
  });

  it("a SavedLook with fromSuggestionId === null is skipped without error", () => {
    const savedSuggestions = resolveSavedSuggestions([{ fromSuggestionId: null }], []);
    assert.deepEqual(savedSuggestions, []);
  });

  it("20 recent unsaved sessions behave exactly as before — all present, none marked saved", () => {
    const history = buildUnifiedHistory(RECENT_20, [], new Set());
    assert.equal(history.length, 20);
    assert.ok(history.every((r) => r.saved === false));
    assert.deepEqual(new Set(history.map((r) => r.id)), RECENT_IDS);
  });

  it("an old UNSAVED session never surfaces regardless of age — never bypasses the cap", () => {
    const displayedMap = buildDisplayedSuggestionMap(RECENT_20);
    const extra = selectExtraSavedSuggestions([], displayedMap); // nothing saved at all
    assert.deepEqual(extra, []);
    const history = buildUnifiedHistory(RECENT_20, [], new Set());
    assert.equal(history.length, 20, "cap of 20 preserved when nothing is saved");
  });

  it("ordering is deterministic and intuitive — single createdAt-desc list, no separate saved section", () => {
    const savedSuggestionIds = new Set(["sugg-old-25"]);
    const extraInputs: ExtraSuggestionInput[] = [extraInput("sugg-old-25", "Old Look", "older-25", "dinner", 45)];
    const history = buildUnifiedHistory(RECENT_20, extraInputs, savedSuggestionIds);
    for (let i = 1; i < history.length; i++) {
      assert.ok(history[i - 1].createdAt >= history[i].createdAt, "strictly non-increasing createdAt order");
    }
  });
});

describe("§ORDERING — cards order by the suggestion's own createdAt, never the parent session's", () => {
  it("a session created long ago whose displayed suggestion was generated just now sorts as recent, not stale", () => {
    // session itself is 10 days old, but its (only) suggestion was just generated
    // seconds ago — e.g. a session resumed for a reroll long after it started.
    const oldSessionFreshSuggestion = session("sx", 10, [
      { id: "sugg-fresh", outfitName: "Fresh", createdAtDaysAgo: 0 },
    ]);
    const freshSession = session("sy", 0, [{ id: "sugg-also-fresh", outfitName: "Also Fresh" }]);
    const history = buildUnifiedHistory([oldSessionFreshSuggestion, freshSession], [], new Set());
    // Both suggestions were generated "now" — they must sort adjacently at the top,
    // not 10 days apart as session.createdAt would have placed them.
    const freshCard = history.find((r) => r.suggestionId === "sugg-fresh")!;
    const alsoFreshCard = history.find((r) => r.suggestionId === "sugg-also-fresh")!;
    assert.ok(
      Math.abs(new Date(freshCard.createdAt).getTime() - new Date(alsoFreshCard.createdAt).getTime()) < 1000,
      "both cards order by their suggestion's own recent createdAt, not the 10-day-old session.createdAt",
    );
  });

  it("an extra (saved, non-displayed) card orders by its suggestion's own createdAt, not its session's createdAt", () => {
    // The session is old (30 days), but the saved suggestion living under it was
    // actually generated only 1 day ago (a late reroll that got saved). It must
    // sort near the top of the list, not buried near 30-day-old history.
    const extraInputs: ExtraSuggestionInput[] = [extraInput("sugg-late-reroll", "Late Reroll", "old-session", "dinner", 1)];
    const savedSuggestionIds = new Set(["sugg-late-reroll"]);
    const history = buildUnifiedHistory([], extraInputs, savedSuggestionIds);
    const cardAgeMs = Date.now() - new Date(history[0].createdAt).getTime();
    assert.ok(cardAgeMs < 2 * 86_400_000, "orders by the 1-day-old suggestion.createdAt, not a 30-day-old session.createdAt");
  });

  it("a session with no suggestion yet (mid-generation) falls back to session.createdAt without crashing", () => {
    const emptySession: HistorySessionInput = { id: "empty", occasion: "everyday", createdAt: new Date(), suggestions: [] };
    const history = buildUnifiedHistory([emptySession], [], new Set());
    assert.equal(history.length, 1);
    assert.equal(history[0].suggestionId, null);
    assert.equal(history[0].saved, false);
  });
});

describe("§RESULT-SECURITY — resolveResultSuggestionSelector (app/routes/style-me/result.tsx ownership scoping)", () => {
  it("12. no suggestionId retains the exact legacy latest-suggestion selector shape", () => {
    const selector = resolveResultSuggestionSelector(null);
    assert.deepEqual(selector, { orderBy: { createdAt: "desc" }, take: 1 });
  });

  it("a requested suggestionId narrows to exactly that id — nested under the caller's own session.suggestions relation", () => {
    const selector = resolveResultSuggestionSelector("sugg-X");
    assert.deepEqual(selector, { where: { id: "sugg-X" } });
    // The function returns ONLY an id filter — it has no sessionId/customerId field of its
    // own to spoof, because it is designed to be spread into an already-scoped relation
    // include (StylingSession.findUnique({ where: { id: sessionId } }).include.suggestions),
    // which Prisma restricts to that session's own suggestions before this filter applies.
    assert.deepEqual(Object.keys(selector), ["where"]);
  });

  it("11. a nonexistent suggestionId still only ever narrows by id — no special-case branch that could widen the query", () => {
    const selector = resolveResultSuggestionSelector("nonexistent-id");
    assert.deepEqual(selector, { where: { id: "nonexistent-id" } });
  });
});
