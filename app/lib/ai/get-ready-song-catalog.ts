// app/lib/ai/get-ready-song-catalog.ts
// Curated "get ready" playlist — verified artist/title pairs, mood-and-occasion tagged.
// Song selection is deterministic: same session input always yields the same song.
//
// Mood IDs match SQ.MOOD options in signal-contract.
// Occasion IDs match SQ.OCCASION options in signal-contract.

export interface GetReadySong {
  title: string;
  artist: string;
  genre: string;
  moods: string[];      // signal-contract mood IDs
  occasions: string[];  // signal-contract occasion IDs
}

export const SONG_CATALOG: readonly GetReadySong[] = [
  // ── Confident / Powerful ─────────────────────────────────────────────────────
  {
    title: "Flawless", artist: "Beyoncé", genre: "R&B",
    moods: ["confident", "powerful"],
    occasions: ["date-night", "girls-night", "special-event", "dinner"],
  },
  {
    title: "Run the World (Girls)", artist: "Beyoncé", genre: "R&B/Pop",
    moods: ["confident", "powerful"],
    occasions: ["everyday", "girls-night", "work"],
  },
  {
    title: "Queen", artist: "Janelle Monáe", genre: "R&B/Pop",
    moods: ["confident", "powerful"],
    occasions: ["everyday", "work", "special-event"],
  },
  {
    title: "Fighter", artist: "Christina Aguilera", genre: "Pop",
    moods: ["confident", "powerful", "need-reset"],
    occasions: ["everyday", "work", "girls-night"],
  },
  {
    title: "Born This Way", artist: "Lady Gaga", genre: "Pop",
    moods: ["confident", "powerful"],
    occasions: ["everyday", "special-event", "girls-night"],
  },
  {
    title: "Girl on Fire", artist: "Alicia Keys", genre: "R&B/Pop",
    moods: ["confident", "powerful", "need-reset"],
    occasions: ["everyday", "work", "special-event"],
  },
  {
    title: "Roar", artist: "Katy Perry", genre: "Pop",
    moods: ["confident", "powerful", "need-reset"],
    occasions: ["everyday", "work"],
  },
  {
    title: "Express Yourself", artist: "Madonna", genre: "Pop",
    moods: ["confident", "powerful", "adventurous"],
    occasions: ["everyday", "work", "girls-night"],
  },
  {
    title: "Vogue", artist: "Madonna", genre: "Pop",
    moods: ["confident", "adventurous", "powerful"],
    occasions: ["girls-night", "special-event", "date-night", "dinner"],
  },
  {
    title: "Edge of Glory", artist: "Lady Gaga", genre: "Pop",
    moods: ["powerful", "confident", "feel-good", "need-reset"],
    occasions: ["special-event", "girls-night", "date-night"],
  },
  {
    title: "Independent Women Pt. I", artist: "Destiny's Child", genre: "R&B/Pop",
    moods: ["confident", "powerful", "feel-good"],
    occasions: ["work", "everyday"],
  },

  // ── Playful / Feel-good ───────────────────────────────────────────────────────
  {
    title: "Shake It Off", artist: "Taylor Swift", genre: "Pop",
    moods: ["adventurous", "feel-good", "need-reset"],
    occasions: ["everyday", "girls-night"],
  },
  {
    title: "Girls Just Want to Have Fun", artist: "Cyndi Lauper", genre: "Pop",
    moods: ["adventurous", "feel-good"],
    occasions: ["girls-night", "everyday"],
  },
  {
    title: "Dancing Queen", artist: "ABBA", genre: "Pop",
    moods: ["adventurous", "feel-good", "romantic"],
    occasions: ["girls-night", "date-night", "special-event"],
  },
  {
    title: "Good as Hell", artist: "Lizzo", genre: "Pop/R&B",
    moods: ["feel-good", "confident", "adventurous", "need-reset"],
    occasions: ["everyday", "girls-night"],
  },
  {
    title: "Juice", artist: "Lizzo", genre: "Pop/R&B",
    moods: ["adventurous", "feel-good", "confident"],
    occasions: ["everyday", "girls-night", "date-night"],
  },
  {
    title: "Happy", artist: "Pharrell Williams", genre: "Pop/Soul",
    moods: ["feel-good", "adventurous", "neutral"],
    occasions: ["everyday", "family", "travel"],
  },
  {
    title: "Material Girl", artist: "Madonna", genre: "Pop",
    moods: ["adventurous", "confident"],
    occasions: ["girls-night", "date-night", "special-event"],
  },
  {
    title: "Bad Romance", artist: "Lady Gaga", genre: "Pop/Electronic",
    moods: ["confident", "adventurous", "powerful", "romantic"],
    occasions: ["special-event", "girls-night", "date-night"],
  },

  // ── Romantic ─────────────────────────────────────────────────────────────────
  {
    title: "Crazy in Love", artist: "Beyoncé", genre: "R&B",
    moods: ["romantic", "confident", "feel-good"],
    occasions: ["date-night", "girls-night", "dinner"],
  },
  {
    title: "Love on the Brain", artist: "Rihanna", genre: "R&B",
    moods: ["romantic", "feel-good"],
    occasions: ["date-night", "dinner"],
  },
  {
    title: "At Last", artist: "Etta James", genre: "Soul/Jazz",
    moods: ["romantic", "feel-good", "neutral"],
    occasions: ["date-night", "dinner", "special-event"],
  },
  {
    title: "La Vie en Rose", artist: "Édith Piaf", genre: "Chanson",
    moods: ["romantic", "neutral", "feel-good"],
    occasions: ["date-night", "dinner", "special-event"],
  },
  {
    title: "Adore You", artist: "Harry Styles", genre: "Pop",
    moods: ["romantic", "feel-good", "adventurous"],
    occasions: ["date-night", "everyday", "dinner"],
  },
  {
    title: "Blue Jeans", artist: "Lana Del Rey", genre: "Indie Pop",
    moods: ["romantic", "neutral"],
    occasions: ["date-night", "dinner", "everyday"],
  },
  {
    title: "Feeling Good", artist: "Nina Simone", genre: "Jazz/Soul",
    moods: ["feel-good", "romantic", "confident", "neutral"],
    occasions: ["everyday", "date-night", "dinner", "special-event"],
  },

  // ── Artsy / Elevated / Indie ──────────────────────────────────────────────────
  {
    title: "Video Games", artist: "Lana Del Rey", genre: "Indie Pop",
    moods: ["romantic", "need-reset", "feeling-low"],
    occasions: ["date-night", "everyday"],
  },
  {
    title: "West Coast", artist: "Lana Del Rey", genre: "Indie Pop",
    moods: ["feel-good", "neutral", "romantic"],
    occasions: ["everyday", "travel", "date-night"],
  },
  {
    title: "Golden", artist: "Harry Styles", genre: "Pop/Rock",
    moods: ["feel-good", "confident", "romantic"],
    occasions: ["everyday", "travel", "date-night"],
  },
  {
    title: "Watermelon Sugar", artist: "Harry Styles", genre: "Pop",
    moods: ["feel-good", "adventurous", "neutral"],
    occasions: ["everyday", "travel", "family"],
  },

  // ── Work / Everyday empowerment ───────────────────────────────────────────────
  {
    title: "9 to 5", artist: "Dolly Parton", genre: "Country/Pop",
    moods: ["adventurous", "feel-good", "neutral"],
    occasions: ["work", "everyday"],
  },
  {
    title: "Work", artist: "Rihanna", genre: "Pop/Dancehall",
    moods: ["confident", "neutral", "feel-good"],
    occasions: ["work", "everyday", "girls-night"],
  },

  // ── Uplifting for tired / low-energy / need-reset ─────────────────────────────
  {
    title: "I Will Survive", artist: "Gloria Gaynor", genre: "Disco",
    moods: ["need-reset", "feeling-low", "self-conscious", "confident"],
    occasions: ["everyday", "girls-night"],
  },
  {
    title: "Brave", artist: "Sara Bareilles", genre: "Pop",
    moods: ["need-reset", "self-conscious", "feeling-low", "neutral"],
    occasions: ["everyday", "work"],
  },
  {
    title: "Rise", artist: "Katy Perry", genre: "Pop",
    moods: ["need-reset", "tired", "low-energy", "confident"],
    occasions: ["everyday", "work", "special-event"],
  },
  {
    title: "Praying", artist: "Kesha", genre: "Pop",
    moods: ["need-reset", "feeling-low", "overwhelmed"],
    occasions: ["everyday"],
  },

  // ── Travel / Easy day ─────────────────────────────────────────────────────────
  {
    title: "Walking on Sunshine", artist: "Katrina and the Waves", genre: "Pop/Rock",
    moods: ["feel-good", "adventurous", "neutral"],
    occasions: ["travel", "everyday"],
  },
  {
    title: "Here Comes the Sun", artist: "The Beatles", genre: "Rock/Folk",
    moods: ["feel-good", "neutral", "need-reset"],
    occasions: ["travel", "everyday", "family"],
  },
  {
    title: "Lovely Day", artist: "Bill Withers", genre: "Soul/R&B",
    moods: ["feel-good", "neutral"],
    occasions: ["everyday", "family", "travel"],
  },
  {
    title: "Sunday Morning", artist: "Maroon 5", genre: "Pop/Soul",
    moods: ["neutral", "feel-good", "romantic"],
    occasions: ["everyday", "family", "not-sure"],
  },
];

// djb2-style hash — same algorithm as the recommendation engine's session fingerprint
function djb2str(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Select a song deterministically from the catalog.
 *
 * Filtering priority:
 *   1. Songs that match at least one mood AND the occasion.
 *   2. Songs that match at least one mood (any occasion).
 *   3. Full catalog (fallback — never empty).
 *
 * Within the filtered pool, the pick is stable across calls with the same
 * `fingerprint` string (the recommendation engine's session fingerprint).
 */
export function selectSong(
  moods: string[],
  occasion: string,
  fingerprint: string,
): GetReadySong {
  const moodSet = new Set(moods);

  const moodAndOccasion = (SONG_CATALOG as GetReadySong[]).filter(
    (s) => s.occasions.includes(occasion) && s.moods.some((m) => moodSet.has(m)),
  );
  const moodOnly = (SONG_CATALOG as GetReadySong[]).filter(
    (s) => s.moods.some((m) => moodSet.has(m)),
  );

  const pool =
    moodAndOccasion.length > 0
      ? moodAndOccasion
      : moodOnly.length > 0
      ? moodOnly
      : (SONG_CATALOG as GetReadySong[]);

  const idx = djb2str(fingerprint) % pool.length;
  return pool[idx];
}
