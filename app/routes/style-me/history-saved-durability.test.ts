// app/routes/style-me/history-saved-durability.test.ts
//
// Saved-look durability closeout. The unified StyleMe history loader caps
// normal history at the 20 most recent sessions, but SavedLook persistence
// itself has no such cap — a look explicitly saved from a session outside
// the recent 20 could remain in the database yet be unreachable from the
// customer UI. These tests exercise the real merge/resolution logic the
// loader calls (not a copy of it), against constructed fixtures — no live
// database needed, matching this codebase's established pattern of testing
// loaders via their extracted pure functions.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSavedSessionIds,
  selectExtraSavedSessionIds,
  mergeHistoryWithSavedSessions,
  type HistorySessionInput,
} from "../../lib/styleme/history-saved-durability";

function session(id: string, daysAgo: number, suggestionId: string | null = `sugg-${id}`): HistorySessionInput {
  return {
    id,
    occasion: "everyday",
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    suggestions: suggestionId ? [{ id: suggestionId, outfitName: `Look ${id}` }] : [],
  };
}

// Recent-20 window: sessions 1..20, one day apart, most recent first conceptually.
const RECENT_20 = Array.from({ length: 20 }, (_, i) => session(`recent-${i + 1}`, i + 1));
const RECENT_IDS = new Set(RECENT_20.map((s) => s.id));

describe("§SAVED-DURABILITY — the real bug: an explicitly saved look outside the recent 20 becomes unreachable", () => {
  it("RED: before resolving saved sessions, a session older than the recent-20 window is absent from history", () => {
    // Session 25 is explicitly saved, but it is NOT inside RECENT_20 (ids 1..20 only).
    // Without the fix, the loader would only ever return RECENT_20 — session 25
    // is reachable in the database (SavedLook row exists) but never surfaced.
    const historyWithoutFix = mergeHistoryWithSavedSessions(RECENT_20, [], new Set());
    assert.equal(historyWithoutFix.some((r) => r.id === "older-25"), false, "older-25 is unreachable — reproduces the real bug");
  });

  it("GREEN: after resolving saved sessions, the same older saved look is present and visibly marked saved", () => {
    const savedLooks = [{ fromSuggestionId: "sugg-older-25" }];
    const resolvedSuggestions = [{ id: "sugg-older-25", sessionId: "older-25" }];
    const savedSessionIds = resolveSavedSessionIds(savedLooks, resolvedSuggestions);
    assert.ok(savedSessionIds.has("older-25"), "older-25 resolved as a saved session");

    const extraIds = selectExtraSavedSessionIds(RECENT_IDS, savedSessionIds);
    assert.deepEqual(extraIds, ["older-25"]);

    const extraSessions = [session("older-25", 30)];
    const history = mergeHistoryWithSavedSessions(RECENT_20, extraSessions, savedSessionIds);

    const found = history.find((r) => r.id === "older-25");
    assert.ok(found, "older-25 is present in unified history");
    assert.equal(found!.saved, true, "older-25 is visibly marked saved");
  });
});

describe("§SAVED-DURABILITY — required behaviors", () => {
  it("1. 20 recent unsaved sessions behave exactly as before — all present, none marked saved", () => {
    const history = mergeHistoryWithSavedSessions(RECENT_20, [], new Set());
    assert.equal(history.length, 20);
    assert.ok(history.every((r) => r.saved === false));
    assert.deepEqual(new Set(history.map((r) => r.id)), RECENT_IDS);
  });

  it("2. an older saved session is included in the merged history", () => {
    const savedSessionIds = new Set(["older-30"]);
    const extraIds = selectExtraSavedSessionIds(RECENT_IDS, savedSessionIds);
    assert.deepEqual(extraIds, ["older-30"]);
    const history = mergeHistoryWithSavedSessions(RECENT_20, [session("older-30", 40)], savedSessionIds);
    assert.ok(history.some((r) => r.id === "older-30"));
    assert.equal(history.length, 21);
  });

  it("3. an older UNSAVED session is excluded — never reaches extraSessionIds, never fetched, never appears", () => {
    // savedSessionIds does not contain "older-unsaved" at all — it was never saved,
    // so it can never bypass the 20-session cap regardless of how old it is.
    const savedSessionIds = new Set<string>(); // nothing saved
    const extraIds = selectExtraSavedSessionIds(RECENT_IDS, savedSessionIds);
    assert.deepEqual(extraIds, [], "no extra ids requested — an unsaved old session never surfaces");
    const history = mergeHistoryWithSavedSessions(RECENT_20, [], savedSessionIds);
    assert.equal(history.some((r) => r.id === "older-unsaved"), false);
    assert.equal(history.length, 20, "cap of 20 preserved when nothing is saved");
  });

  it("4. recent+saved overlap is deduplicated — a saved session already inside the recent 20 is not fetched twice", () => {
    const savedSessionIds = new Set(["recent-5", "older-25"]); // recent-5 is already in RECENT_20
    const extraIds = selectExtraSavedSessionIds(RECENT_IDS, savedSessionIds);
    assert.deepEqual(extraIds, ["older-25"], "recent-5 excluded from the extra fetch — already present");
    const history = mergeHistoryWithSavedSessions(RECENT_20, [session("older-25", 50)], savedSessionIds);
    const matches = history.filter((r) => r.id === "recent-5");
    assert.equal(matches.length, 1, "exactly one card for recent-5 — no duplicate");
    assert.equal(matches[0].saved, true, "recent-5 is still correctly marked saved");
  });

  it("5. multiple older saved sessions behave deterministically regardless of input order", () => {
    const savedSessionIds = new Set(["older-25", "older-40", "older-33"]);
    const extraUnsorted = [session("older-40", 60), session("older-25", 45), session("older-33", 50)];
    const historyA = mergeHistoryWithSavedSessions(RECENT_20, extraUnsorted, savedSessionIds);
    const historyB = mergeHistoryWithSavedSessions(RECENT_20, [...extraUnsorted].reverse(), savedSessionIds);
    assert.deepEqual(historyA.map((r) => r.id), historyB.map((r) => r.id), "same output regardless of fetch order");
    // createdAt descending: older-25 (45d) newer than older-33 (50d) newer than older-40 (60d)
    const ids = historyA.map((r) => r.id);
    assert.ok(ids.indexOf("older-25") < ids.indexOf("older-33"));
    assert.ok(ids.indexOf("older-33") < ids.indexOf("older-40"));
  });

  it("6. unsaving an older saved look removes its special visibility entitlement", () => {
    const savedBefore = new Set(["older-25"]);
    const extraBefore = selectExtraSavedSessionIds(RECENT_IDS, savedBefore);
    assert.deepEqual(extraBefore, ["older-25"]);

    // The look is unsaved — its SavedLook row no longer exists, so it no longer
    // resolves into savedSessionIds on the next load.
    const savedAfter = resolveSavedSessionIds([], []); // no SavedLook rows at all now
    assert.equal(savedAfter.has("older-25"), false);
    const extraAfter = selectExtraSavedSessionIds(RECENT_IDS, savedAfter);
    assert.deepEqual(extraAfter, [], "older-25 no longer requested once unsaved");

    const historyAfter = mergeHistoryWithSavedSessions(RECENT_20, [], savedAfter);
    assert.equal(historyAfter.some((r) => r.id === "older-25"), false, "older-25 disappears again after unsaving");
  });

  it("7. a stale SavedLook pointing at a deleted suggestion fails safely — no crash, no phantom entry", () => {
    const savedLooks = [
      { fromSuggestionId: "sugg-deleted-suggestion" }, // suggestion no longer exists
      { fromSuggestionId: "sugg-older-25" }, // this one still resolves
    ];
    const resolvedSuggestions = [{ id: "sugg-older-25", sessionId: "older-25" }]; // deleted one absent, as Prisma would return
    const savedSessionIds = resolveSavedSessionIds(savedLooks, resolvedSuggestions);
    assert.deepEqual([...savedSessionIds], ["older-25"], "stale reference silently skipped, valid one still resolves");
  });

  it("a SavedLook with fromSuggestionId === null is skipped without error", () => {
    const savedSessionIds = resolveSavedSessionIds([{ fromSuggestionId: null }], []);
    assert.equal(savedSessionIds.size, 0);
  });

  it("ordering is deterministic and intuitive — single createdAt-desc list, no separate saved section", () => {
    const savedSessionIds = new Set(["older-25"]);
    const history = mergeHistoryWithSavedSessions(RECENT_20, [session("older-25", 45)], savedSessionIds);
    for (let i = 1; i < history.length; i++) {
      assert.ok(history[i - 1].createdAt >= history[i].createdAt, "strictly non-increasing createdAt order");
    }
  });
});
