/**
 * Shared Customer Intelligence — Phase 4, considered-event derivation.
 *
 * Pure module: no DB, no LLM, no side effects. Takes already-fetched
 * BuyOrSkipAnalysis facts and collapses them into distinct "considered"
 * events — one per genuine real-world consideration, not one per DB row.
 *
 * Why collapsing is needed at all: a read-only check against production
 * data (54 rows) found that one row is NOT reliably one consideration.
 * 47 distinct (customer, image) pairs produced 54 rows — 4 pairs had
 * repeat analyses of the exact same photographed item, with gaps ranging
 * 16 minutes to 4.2 hours, well outside the existing 60-second technical-
 * retry idempotency window (that window already fully prevents duplicate
 * rows from accidental double-submits/network retries — this module
 * handles a different, slower pattern: the customer deliberately
 * re-running analysis on the same photo).
 *
 * Two consecutive analyses of the same image collapse into one episode
 * only when ALL of the following hold:
 *   1. same customer;
 *   2. same image identity (imagePublicId ?? imageUrl);
 *   3. gap <= the 20-minute provisional window;
 *   4. same category;
 *   5. the customer-provided consideration inputs (colors, forOccasion,
 *      whatLike, unsureAbout, itemSize, colorNote) are materially
 *      unchanged — see buildConsiderationSignature().
 *
 * Condition 5 exists because category alone is not enough: a customer can
 * genuinely reconsider the same garment within the window for a different
 * purpose while keeping the same category (e.g. "would this work for a
 * birthday lunch?" then, 5 minutes later, "would this work for a work
 * dinner?" — same photo, same category, two real distinct considerations).
 * Only genuine customer-entered fields participate in the signature — AI
 * output (verdict, confidence, fullAnalysis, reasoning, closet pairings,
 * or anything else nAia generated) is never part of event identity; two
 * analyses with identical customer inputs are the same consideration event
 * even if nAia's own output differs between them.
 *
 * The episode rule was derived from inspecting the 4 real repeat-image
 * groups, not chosen in the abstract — see the module's test file. It
 * deliberately does NOT collapse purely on "same image, any time apart"
 * (rejected: one real group showed four re-analyses of the same photo over
 * ~3.5 hours, each with materially different forOccasion/whatLike/
 * unsureAbout text — reading as the customer evaluating the same garment
 * against different hypothetical occasions, not fixing a mistake; treating
 * those as one event would erase that). It also does not collapse across
 * a category change even when the gap is tiny (one real group re-analyzed
 * the same photo as "Top" then, 2 minutes later, as "Jewelry" — this could
 * be a genuine correction, or two different items in the same photo; there
 * is no way to tell which from the data available, so the conservative
 * choice is to never silently discard one).
 *
 * PROVISIONAL: the 20-minute window is sized from exactly those 4 groups
 * (collapses a 16-minute same-signature repeat; does not collapse the
 * shortest "different occasion" gap at 22 minutes). It is not validated
 * against a larger sample and should be revisited if more repeat-episode
 * data accumulates.
 */

export interface ConsideredAnalysisFact {
  id: string;
  customerId: string;
  imagePublicId: string | null;
  imageUrl: string | null;
  category: string | null;
  colors: readonly string[] | null;
  forOccasion: string | null;
  whatLike: string | null;
  unsureAbout: string | null;
  itemSize: string | null;
  colorNote: string | null;
  createdAt: Date;
}

export interface ConsideredEvent {
  /** The representative analysis id — the latest row in the episode. */
  id: string;
  customerId: string;
  category: string;
  observedAt: Date;
}

export const CONSIDERED_EPISODE_WINDOW_MS = 20 * 60 * 1000;

/**
 * Normalized form of the genuine customer-input fields that make two
 * analyses "the same consideration" rather than two different ones.
 * Deliberately excludes category — category is checked as its own
 * condition, not folded into this signature.
 */
interface ConsiderationSignature {
  colors: readonly string[];
  forOccasion: string | null;
  whatLike: string | null;
  unsureAbout: string | null;
  itemSize: string | null;
  colorNote: string | null;
}

function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeColors(colors: readonly string[] | null | undefined): readonly string[] {
  if (!colors) return [];
  return [...colors]
    .map((c) => c.trim())
    .filter((c) => c !== "")
    .sort();
}

function buildConsiderationSignature(fact: ConsideredAnalysisFact): ConsiderationSignature {
  return {
    colors: normalizeColors(fact.colors),
    forOccasion: normalizeText(fact.forOccasion),
    whatLike: normalizeText(fact.whatLike),
    unsureAbout: normalizeText(fact.unsureAbout),
    itemSize: normalizeText(fact.itemSize),
    colorNote: normalizeText(fact.colorNote),
  };
}

function signaturesEqual(a: ConsiderationSignature, b: ConsiderationSignature): boolean {
  return (
    a.forOccasion === b.forOccasion &&
    a.whatLike === b.whatLike &&
    a.unsureAbout === b.unsureAbout &&
    a.itemSize === b.itemSize &&
    a.colorNote === b.colorNote &&
    a.colors.length === b.colors.length &&
    a.colors.every((c, i) => c === b.colors[i])
  );
}

function toEvent(fact: ConsideredAnalysisFact): ConsideredEvent {
  return { id: fact.id, customerId: fact.customerId, category: fact.category as string, observedAt: fact.createdAt };
}

export function deriveConsideredEvents(facts: readonly ConsideredAnalysisFact[]): ConsideredEvent[] {
  // Nothing to report without a category — there is no honest value to emit.
  const withCategory = facts.filter((f) => f.category);

  const groups = new Map<string, ConsideredAnalysisFact[]>();
  for (const fact of withCategory) {
    // A row with neither imagePublicId nor imageUrl has no provable identity
    // against any other row — give it a unique key so it is never collapsed.
    const assetKey = fact.imagePublicId ?? fact.imageUrl ?? `__no-asset__:${fact.id}`;
    const key = `${fact.customerId}::${assetKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(fact);
    groups.set(key, arr);
  }

  const events: ConsideredEvent[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let episodeLatest = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const withinWindow = cur.createdAt.getTime() - prev.createdAt.getTime() <= CONSIDERED_EPISODE_WINDOW_MS;
      const sameCategory = cur.category === prev.category;
      const sameSignature = signaturesEqual(buildConsiderationSignature(prev), buildConsiderationSignature(cur));
      if (withinWindow && sameCategory && sameSignature) {
        episodeLatest = cur;
      } else {
        events.push(toEvent(episodeLatest));
        episodeLatest = cur;
      }
    }
    events.push(toEvent(episodeLatest));
  }
  return events;
}
