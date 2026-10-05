// app/lib/styleme/occasion-display.ts
//
// How the result page names the occasion back to her.
//
// Three vocabularies exist for one answer, and only the first is hers:
//
//   questionnaire option label   "Night out / party"     what she read and chose
//   canonical session ID         "girls-night"           what the engine stores and gates on
//   closet occasion token        "evening" | "girls-night"  what garment metadata is tagged with
//
// The result page was naming the occasion from a map keyed on the canonical ID, with values
// written independently of the questionnaire. For three occasions the two had drifted apart:
//
//   she chose "Night out / party"     → the result said "Evening out"
//   she chose "Date"                  → the result said "Date night"
//   she chose "Event / celebration"   → the result said "Special event"
//
// "Evening out" shares no word with what she picked. The canonical IDs are not the problem —
// `girls-night` is a legacy internal name that could never be shown to a customer, and
// de-gendering it for display was right. It was done in the wrong place, by inventing new
// wording instead of echoing hers.
//
// PRESENTATION ONLY. Nothing here is read by a gate, a score, a prompt or a persisted field.
// `session.occasion` keeps the canonical ID, REV3_OCCASION_MAP is untouched, and this module
// imports nothing server-side so a route component can use it safely.
//
// TWO SOURCES, DELIBERATELY. `occasionDisplayLabel` is captured from the questionnaire at
// answer time and is the better source: it preserves the wording she actually saw, so an old
// suggestion still echoes it after the questionnaire copy changes. But it only reaches the
// page on the fresh-generation path, because StylingSession has no column for it and adding
// one would be a persistence change. On reload and on a saved look the page has nothing but
// the canonical ID — so OCCASION_DISPLAY_LABELS below has to be correct in its own right,
// not merely a safety net. Leaving it as it was would have meant the fix evaporating on
// every page refresh.

/**
 * Canonical session occasion → the questionnaire's own option label.
 *
 * Every value is the exact `label` string from `occasions` in app/routes/style-me/occasion.tsx,
 * resolved through REV3_OCCASION_MAP. OD-F pins that correspondence so the two cannot drift
 * apart again without a test failing.
 *
 * `not-sure` has no questionnaire option of its own — "other" maps onto it — so it keeps a
 * written label.
 */
export const OCCASION_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  "everyday": "Everyday or casual plans",
  "work": "Work or meetings",
  "dinner": "Dinner",
  "date-night": "Date",
  "girls-night": "Night out / party",
  "special-event": "Event / celebration",
  "family": "Family gathering",
  "travel": "Travel day",
  "active": "Active / busy day",
  "not-sure": "Not sure yet",
};

/**
 * What to print where the page names the occasion.
 *
 * Precedence: the label she actually saw, then the questionnaire label for her canonical
 * answer, then the raw value. The last step keeps an unrecognised or future occasion ID
 * rendering as something rather than blank — the behaviour this replaced already did that,
 * and it is the only reason an unknown ID is not an error here.
 *
 * A blank or whitespace-only stored label is treated as absent: an empty "Dressing for"
 * value is worse than slightly stale wording.
 */
export function occasionDisplayFor(
  occasionDisplayLabel: string | null | undefined,
  canonicalOccasion: string | null | undefined,
): string {
  const stored = occasionDisplayLabel?.trim();
  if (stored) return stored;
  if (!canonicalOccasion) return "";
  return OCCASION_DISPLAY_LABELS[canonicalOccasion] ?? canonicalOccasion;
}
