/**
 * Derives the verdict-aware section heading from the stored AI verdict string.
 *
 * Uses the same canonical value that populates the top verdict badge.
 * Normalises whitespace and casing so AI output variations don't break matching.
 */
export function verdictHeading(rawVerdict: string | null | undefined): string {
  const v = String(rawVerdict ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (v === "BUY") return "Why It Works";
  if (v === "SKIP FOR NOW" || v === "MAYBE") return "Why It May Not Work Yet";
  return "Why It Doesn't Work";
}

/**
 * Returns true when the normalised verdict is a skip variant.
 * Used to determine content ordering in the analysis section.
 */
export function isSkipVerdict(rawVerdict: string | null | undefined): boolean {
  const v = String(rawVerdict ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  return v === "SKIP" || v === "SKIP FOR NOW";
}
