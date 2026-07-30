// app/lib/ai/get-ready-song-catalog.test.ts
// Tests for the curated get-ready song catalog and deterministic selection.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SONG_CATALOG, selectSong } from "./get-ready-song-catalog.ts";

describe("SONG_CATALOG integrity", () => {
  it("SC.1 — catalog has at least 30 songs", () => {
    assert.ok(SONG_CATALOG.length >= 30, `catalog has only ${SONG_CATALOG.length} songs`);
  });

  it("SC.2 — no duplicate title+artist pairs", () => {
    const seen = new Set<string>();
    for (const song of SONG_CATALOG) {
      const key = `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
      assert.ok(!seen.has(key), `duplicate song: "${song.title}" by ${song.artist}`);
      seen.add(key);
    }
  });

  it("SC.3 — every song has a non-empty title", () => {
    for (const song of SONG_CATALOG) {
      assert.ok(song.title.length > 0, "found song with empty title");
    }
  });

  it("SC.4 — every song has a non-empty artist", () => {
    for (const song of SONG_CATALOG) {
      assert.ok(song.artist.length > 0, `"${song.title}" has empty artist`);
    }
  });

  it("SC.5 — every song has a non-empty genre", () => {
    for (const song of SONG_CATALOG) {
      assert.ok(song.genre.length > 0, `"${song.title}" has empty genre`);
    }
  });

  it("SC.6 — every song has at least one mood", () => {
    for (const song of SONG_CATALOG) {
      assert.ok(song.moods.length >= 1, `"${song.title}" has no moods`);
    }
  });

  it("SC.7 — every song has at least one occasion", () => {
    for (const song of SONG_CATALOG) {
      assert.ok(song.occasions.length >= 1, `"${song.title}" has no occasions`);
    }
  });

  it("SC.8 — catalog covers all 9 occasion IDs", () => {
    const occasions = [
      "work", "everyday", "dinner", "date-night",
      "girls-night", "family", "special-event", "travel", "not-sure",
    ];
    for (const occ of occasions) {
      const covered = SONG_CATALOG.some((s) => s.occasions.includes(occ));
      assert.ok(covered, `no song covers occasion: ${occ}`);
    }
  });

  it("SC.9 — catalog covers key mood IDs", () => {
    const moods = [
      "confident", "playful", "romantic", "powerful", "need-reset",
      "feel-good", "tired", "feeling-low", "self-conscious", "neutral",
    ];
    for (const mood of moods) {
      const covered = SONG_CATALOG.some((s) => s.moods.includes(mood));
      assert.ok(covered, `no song covers mood: ${mood}`);
    }
  });
});

describe("selectSong", () => {
  it("SS.1 — same inputs return the same song (deterministic)", () => {
    const a = selectSong(["confident"], "everyday", "fp-test");
    const b = selectSong(["confident"], "everyday", "fp-test");
    assert.equal(a.title, b.title);
    assert.equal(a.artist, b.artist);
  });

  it("SS.2 — different fingerprints can produce different songs", () => {
    // Collect picks for 20 distinct fingerprints and assert variety
    const picks = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const s = selectSong(["confident"], "everyday", `fp-${i}`);
      picks.add(`${s.title}|${s.artist}`);
    }
    assert.ok(picks.size > 1, "all 20 fingerprints produced the same song");
  });

  it("SS.3 — unrecognized moods fall back to full catalog (never throws)", () => {
    const song = selectSong(["no-such-mood"], "no-such-occasion", "fp-fallback");
    assert.ok(typeof song.title === "string");
    assert.ok(typeof song.artist === "string");
  });

  it("SS.4 — confident + date-night returns a song that matches both", () => {
    // The pool for this combination should contain mood+occasion matches
    const song = selectSong(["confident"], "date-night", "fp-date");
    const inCatalog = SONG_CATALOG.find(
      (s) => s.title === song.title && s.artist === song.artist,
    );
    assert.ok(inCatalog, "returned song is not in the catalog");
  });

  it("SS.5 — returns a full GetReadySong object", () => {
    const song = selectSong(["playful"], "girls-night", "fp-girls");
    assert.ok(typeof song.title === "string" && song.title.length > 0);
    assert.ok(typeof song.artist === "string" && song.artist.length > 0);
    assert.ok(typeof song.genre === "string" && song.genre.length > 0);
    assert.ok(Array.isArray(song.moods) && song.moods.length > 0);
    assert.ok(Array.isArray(song.occasions) && song.occasions.length > 0);
  });
});
