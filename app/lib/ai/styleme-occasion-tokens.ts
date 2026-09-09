// app/lib/ai/styleme-occasion-tokens.ts
// Single canonical vocabulary bridge between session occasion IDs and the
// closet-AI occasion vocabulary (GARMENT_OCCASION_VALUES). Both
// styleme-result.server.ts and styleme-anchor.server.ts import from here.
// Do NOT duplicate this map — all occasion matching must flow through this file.

// Maps session occasion ID → closet vocabulary tokens.
// Each entry includes BOTH the Closet AI vocabulary tokens (GARMENT_OCCASION_VALUES)
// AND the session ID itself as a fallback, so items tagged manually with session IDs
// (before AI analysis) still match.
// "everyday" uses "casual"/"weekend" because the Closet AI emits those for everyday garments.
// "dinner"/"girls-night" map to "evening"; "special-event" maps to "special-occasion".
export const SESSION_OCCASION_TO_CLOSET_TOKENS: Record<string, readonly string[]> = {
  "everyday":      ["casual", "weekend", "everyday"],           // AI: casual/weekend; legacy: everyday
  "work":          ["work"],                                    // AI = session ID
  "dinner":        ["evening", "dinner"],                       // AI: evening; legacy: dinner
  "date-night":    ["date-night"],                              // AI = session ID
  "girls-night":   ["evening", "girls-night"],                  // AI: evening; legacy: girls-night
  "special-event": ["special-occasion", "special-event"],       // AI: special-occasion; legacy: special-event
  "travel":        ["travel"],                                  // AI = session ID
  "family":        ["family"],                                  // no AI equiv — keep session ID as legacy match
  "not-sure":      [],                                          // no meaningful match
};

// Returns true when the item's stored occasion tags include at least one token that
// the normalization map considers equivalent to the session's occasion.
// Returns false (not neutral) only when itemOccasions is non-empty; empty = "no-metadata".
// For session occasions NOT in the map (e.g. "smart-casual"), falls back to direct string
// match so pre-existing items tagged with that exact string still work.
export function matchesSessionOccasion(itemOccasions: string[], sessionOccasion: string): boolean {
  if (itemOccasions.length === 0) return false;
  const tokens = SESSION_OCCASION_TO_CLOSET_TOKENS[sessionOccasion];
  if (tokens === undefined) {
    // Unknown session occasion — fall back to direct string match for backward compatibility
    return itemOccasions.includes(sessionOccasion);
  }
  if (tokens.length === 0) return false;
  return itemOccasions.some((o) => tokens.includes(o));
}
