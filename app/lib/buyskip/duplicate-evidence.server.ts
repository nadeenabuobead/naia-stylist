// app/lib/buyskip/duplicate-evidence.server.ts
// Deterministic duplicate/overlap detection (Phase 5 of the Buy/Skip product foundation).
//
// This replaces the model's free judgement of "do you already own this" with a
// field-by-field comparison against the customer's own same-category Closet
// items. Same category is the eligibility gate for comparison, never the
// verdict itself — category match alone is never reported as overlap.
//
// Deliberately NOT a parallel canonical-GI similarity engine: it only compares
// the handful of fields already stored on ClosetItem against the vision
// model's own stated observations for the candidate (see product-facts.server).

import type { ProductFacts } from "./product-facts.server";

export type DuplicateOverlapLevel = "strong-overlap" | "some-overlap" | "no-supported-overlap" | "unknown";

export interface DuplicateMatch {
  closetItemName: string;
  matchedFields: string[];
  matchCount: number;
}

export interface DuplicateEvidence {
  overlap: DuplicateOverlapLevel;
  matches: DuplicateMatch[];
  sameSlotCandidateCount: number;
}

export interface SameSlotClosetItem {
  name: string;
  category: string;
  primaryColor?: string | null;
  silhouette?: string | null;
  fitProfile?: string | null;
  formality?: string | null;
  sleeveLength?: string | null;
  necklineCoverage?: string | null;
}

const STRONG_OVERLAP_THRESHOLD = 3;
const SOME_OVERLAP_THRESHOLD = 1;

function normalize(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  return t === "" || t === "n/a" ? null : t;
}

function colorsOverlap(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Compares the candidate's vision-inferred facts against each same-category
 * Closet item. A field only counts toward the match score when BOTH sides
 * have a known value — missing data on either side is never scored as a
 * match or a mismatch. This is what keeps "unknown" from silently becoming
 * "no overlap".
 */
export function computeDuplicateEvidence(
  facts: ProductFacts,
  sameSlotClosetItems: SameSlotClosetItem[],
): DuplicateEvidence {
  const sameSlotCandidateCount = sameSlotClosetItems.length;

  if (sameSlotCandidateCount === 0) {
    // Deterministically known: there is nothing in this category to overlap with.
    return { overlap: "no-supported-overlap", matches: [], sameSlotCandidateCount: 0 };
  }

  const candidateColor = normalize(facts.detectedColor.value);
  const candidateSilhouette = normalize(facts.silhouette.value);
  const candidateFit = normalize(facts.fitProfile.value);
  const candidateFormality = normalize(facts.formality.value);
  const candidateSleeve = normalize(facts.sleeveLength.value);
  const candidateNeckline = normalize(facts.necklineCoverage.value);

  const hasAnyCandidateField =
    candidateColor || candidateSilhouette || candidateFit || candidateFormality || candidateSleeve || candidateNeckline;

  if (!hasAnyCandidateField) {
    // The vision model gave us nothing comparable for this candidate.
    return { overlap: "unknown", matches: [], sameSlotCandidateCount };
  }

  const matches: DuplicateMatch[] = [];

  for (const item of sameSlotClosetItems) {
    const matchedFields: string[] = [];

    const itemColor = normalize(item.primaryColor);
    if (candidateColor && itemColor && colorsOverlap(candidateColor, itemColor)) matchedFields.push("color");

    const itemSilhouette = normalize(item.silhouette);
    if (candidateSilhouette && itemSilhouette && candidateSilhouette === itemSilhouette) matchedFields.push("silhouette");

    const itemFit = normalize(item.fitProfile);
    if (candidateFit && itemFit && candidateFit === itemFit) matchedFields.push("fitProfile");

    const itemFormality = normalize(item.formality);
    if (candidateFormality && itemFormality && candidateFormality === itemFormality) matchedFields.push("formality");

    const itemSleeve = normalize(item.sleeveLength);
    if (candidateSleeve && itemSleeve && candidateSleeve === itemSleeve) matchedFields.push("sleeveLength");

    const itemNeckline = normalize(item.necklineCoverage);
    if (candidateNeckline && itemNeckline && candidateNeckline === itemNeckline) matchedFields.push("necklineCoverage");

    if (matchedFields.length > 0) {
      matches.push({ closetItemName: item.name, matchedFields, matchCount: matchedFields.length });
    }
  }

  // Deterministic ordering: highest match count first, then by name — never by
  // array-arrival order or any item-id-derived ordering.
  matches.sort((a, b) => b.matchCount - a.matchCount || a.closetItemName.localeCompare(b.closetItemName));

  const topScore = matches[0]?.matchCount ?? 0;
  let overlap: DuplicateOverlapLevel;
  if (topScore >= STRONG_OVERLAP_THRESHOLD) overlap = "strong-overlap";
  else if (topScore >= SOME_OVERLAP_THRESHOLD) overlap = "some-overlap";
  else overlap = "no-supported-overlap";

  return { overlap, matches, sameSlotCandidateCount };
}
