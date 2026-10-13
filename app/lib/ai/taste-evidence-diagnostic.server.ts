// app/lib/ai/taste-evidence-diagnostic.server.ts
// READ-ONLY diagnostic engine for "What nAia Is Noticing" (Taste & Evidence Layer V1).
//
// Kept as reusable local tooling after the V1 Noticing/Passport QA round
// closed — see scripts/qa-noticing-evidence-diagnostic.ts for the CLI that
// uses it. The staging-only HTTP route that also used this during manual
// QA (api.staging-noticing-diagnostic.ts) has been removed along with the
// rest of the TEMP QA tooling; this file exposes no customer-facing route
// of its own.
//
// What this does:
//   1. Reads the LIVE TasteEvidence + StyleTendency rows exactly as stored
//      (the real ground truth the page currently renders from).
//   2. Re-runs the real, unmodified extraction functions
//      (extractStyleMeEvidence / extractPostWearEvidence / extractClosetEvidence /
//      extractBuySkipEvidence from taste-extraction.server.ts) over the customer's
//      raw source records, to check whether stored evidence is stale/incomplete
//      relative to what a fresh backfill would derive, and to explain exactly
//      which raw records produced zero evidence and why.
//   3. Reimplements the engine's own aggregation/threshold math
//      (mirrors taste-reconcile.server.ts's aggregateEvidence/classifyContradiction/
//      computeState) against both the live-stored evidence and the freshly-derived
//      evidence, importing every threshold constant directly from taste-contract.ts
//      so this can never drift from the real values.
//
// What this does NOT do:
//   - No prisma create/update/delete/upsert of any kind.
//   - No call to writeSourceEvidence() or reconcileObservations() (both write to DB).
//   - No threshold or application-code changes.
//   - Never returns DATABASE_URL, secrets, tokens, or any other customer's data.

import prisma from "../../db.server.js";
import {
  extractStyleMeEvidence,
  extractPostWearEvidence,
  extractClosetEvidence,
  extractBuySkipEvidence,
} from "./taste-extraction.server.js";
import {
  type TasteEvidenceInsert,
  CANDIDATE_EFFECTIVE_SUPPORT,
  CANDIDATE_WNET,
  CANDIDATE_DISTINCT_RECORDS,
  CONFIRMED_EFFECTIVE_SUPPORT,
  CONFIRMED_WNET,
  CONFIRMED_DISTINCT_RECORDS,
  SUPPRESS_RATIO,
  CONTEST_RATIO,
  CROSS_SOURCE_BONUS,
} from "./taste-contract.js";

// ── Reimplemented engine math (read-only mirror of taste-reconcile.server.ts) ─
// Formulas copied verbatim from reconcileObservations/aggregateEvidence/
// classifyContradiction/computeState. Thresholds are imported, never hardcoded.

type EvRow = { source: string; sourceRecordId: string; dimension: string; value: string; polarity: string; strength: number };

function aggregate(rows: EvRow[]) {
  let wPositive = 0, wNegative = 0;
  const posRecords = new Set<string>(), negRecords = new Set<string>();
  const posSources = new Set<string>(), negSources = new Set<string>();
  const allSources = new Set<string>();
  const bySource: Record<string, { positive: number; negative: number; positiveRecords: Set<string>; negativeRecords: Set<string> }> = {};

  for (const ev of rows) {
    allSources.add(ev.source);
    bySource[ev.source] ??= { positive: 0, negative: 0, positiveRecords: new Set(), negativeRecords: new Set() };
    const compositeId = `${ev.source}|${ev.sourceRecordId}`;
    if (ev.polarity === "positive") {
      wPositive += ev.strength;
      posRecords.add(compositeId);
      posSources.add(ev.source);
      bySource[ev.source].positive += ev.strength;
      bySource[ev.source].positiveRecords.add(compositeId);
    } else {
      wNegative += ev.strength;
      negRecords.add(compositeId);
      negSources.add(ev.source);
      bySource[ev.source].negative += ev.strength;
      bySource[ev.source].negativeRecords.add(compositeId);
    }
  }

  return {
    wPositive, wNegative,
    distinctPositiveRecords: posRecords.size,
    distinctNegativeRecords: negRecords.size,
    distinctPositiveSources: posSources.size,
    distinctNegativeSources: negSources.size,
    allSourcesUsed: Array.from(allSources),
    bySource,
  };
}

type ContradictionClass = "SUPPRESSED" | "CANDIDATE_ONLY" | "CONFIRMED_ELIGIBLE";

function classifyContradiction(wSupport: number, wContradict: number): ContradictionClass {
  if (wSupport === 0) return "SUPPRESSED";
  if (wContradict >= wSupport * SUPPRESS_RATIO) return "SUPPRESSED";
  if (wContradict >= wSupport * CONTEST_RATIO) return "CANDIDATE_ONLY";
  return "CONFIRMED_ELIGIBLE";
}

function computeState(effectiveSupport: number, wNet: number, distinctRecords: number, contradictionClass: ContradictionClass): string {
  if (contradictionClass === "SUPPRESSED") return "SUPPRESSED";
  const meetsConfirmed =
    effectiveSupport >= CONFIRMED_EFFECTIVE_SUPPORT &&
    wNet >= CONFIRMED_WNET &&
    distinctRecords >= CONFIRMED_DISTINCT_RECORDS;
  const meetsCandidate =
    effectiveSupport >= CANDIDATE_EFFECTIVE_SUPPORT &&
    wNet >= CANDIDATE_WNET &&
    distinctRecords >= CANDIDATE_DISTINCT_RECORDS;
  if (meetsConfirmed && contradictionClass === "CONFIRMED_ELIGIBLE") return "CONFIRMED";
  if (meetsCandidate) return "CANDIDATE";
  return "SUPPRESSED";
}

function groupClaims(rows: EvRow[]) {
  const byKey = new Map<string, EvRow[]>();
  for (const r of rows) {
    const key = `${r.dimension}|${r.value}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  const claims = [];
  for (const [key, group] of byKey) {
    const [dimension, value] = key.split("|");
    const agg = aggregate(group);
    const dominantPolarity = agg.wPositive >= agg.wNegative ? "positive" : "negative";
    const wSupport = dominantPolarity === "positive" ? agg.wPositive : agg.wNegative;
    const wContradict = dominantPolarity === "positive" ? agg.wNegative : agg.wPositive;
    const distinctRecords = dominantPolarity === "positive" ? agg.distinctPositiveRecords : agg.distinctNegativeRecords;
    const distinctSources = dominantPolarity === "positive" ? agg.distinctPositiveSources : agg.distinctNegativeSources;
    const wNet = wSupport - wContradict;
    const crossSourceBonus = distinctSources >= 2 ? CROSS_SOURCE_BONUS : 1.0;
    const effectiveSupport = wSupport * crossSourceBonus;
    const contradictionClass = classifyContradiction(wSupport, wContradict);
    const resultingState = computeState(effectiveSupport, wNet, distinctRecords, contradictionClass);
    const contradictionRatio = wSupport === 0 ? null : Number((wContradict / wSupport).toFixed(4));

    const sourceBreakdown = Object.fromEntries(
      Object.entries(agg.bySource).map(([src, s]) => [
        src,
        {
          positiveRecords: s.positiveRecords.size,
          negativeRecords: s.negativeRecords.size,
          weightedPositive: Number(s.positive.toFixed(4)),
          weightedNegative: Number(s.negative.toFixed(4)),
        },
      ])
    );

    claims.push({
      dimension,
      value,
      dominantPolarity,
      sourceBreakdown,
      rawSupport: { positiveRecords: agg.distinctPositiveRecords, negativeRecords: agg.distinctNegativeRecords },
      weightedPositive: Number(agg.wPositive.toFixed(4)),
      weightedNegative: Number(agg.wNegative.toFixed(4)),
      weightedNet: Number(wNet.toFixed(4)),
      recordCount: distinctRecords,
      distinctSources,
      crossSourceBonusApplied: crossSourceBonus > 1,
      effectiveSupport: Number(effectiveSupport.toFixed(4)),
      contradictionRatio,
      contradictionClass,
      resultingState,
      // Gap to CANDIDATE — 0 or negative means the threshold is already met.
      gapToCandidate: {
        effectiveSupport: Number((CANDIDATE_EFFECTIVE_SUPPORT - effectiveSupport).toFixed(4)),
        wNet: Number((CANDIDATE_WNET - wNet).toFixed(4)),
        distinctRecords: CANDIDATE_DISTINCT_RECORDS - distinctRecords,
      },
    });
  }

  return claims.sort((a, b) => b.effectiveSupport - a.effectiveSupport);
}

// ── Known V1 extraction rules, for human-readable exclusion reasons ──────────
// Mirrors the // SKIP comments in taste-extraction.server.ts exactly. If this
// list goes stale relative to that file, the diagnostic still works — it just
// falls back to a generic "no rule matched" reason instead of naming the
// specific skipped tag.

const STYLEME_SKIP_TAGS = new Set([
  "felt-confident", "got-compliments", "occasion-right", "other",
  "shoes", "top", "bottom", "layer", "more-coverage", "different-colour",
  "style-mood-changed", "weather", "plans-changed", "not-ready",
]);
const REVIEW_SKIP_FIELDS = ["desiredFeelingAchieved", "workedTags", "didntWorkTags", "colourFeedback", "coverageFeedback"];
const CLOSET_SKIP_RELATIONSHIPS = new Set(["love-style-struggle", "like", "unsure", "occasion-only"]);

function explainStyleMeExclusion(outcome: any): string {
  const allTags = [...outcome.whatWorked, ...outcome.whatFeltOff, ...outcome.changeTypes, ...(outcome.outcomeStatus === "didnt-wear-it" ? outcome.didntWearReasons : [])];
  if (allTags.length === 0) return "no whatWorked/whatFeltOff/changeTypes/didntWearReasons tags present on this outcome";
  const skipped = allTags.filter((t: string) => STYLEME_SKIP_TAGS.has(t));
  if (skipped.length === allTags.length) return `only tags with no V1 extraction rule were present: ${[...new Set(skipped)].join(", ")}`;
  if (outcome.outcomeStatus === "didnt-wear-it" && outcome.didntWearReasons.length && !outcome.didntWearReasons.includes("comfort-concern")) {
    return `didnt-wear-it with reasons [${outcome.didntWearReasons.join(", ")}] — only "comfort-concern" has a V1 rule`;
  }
  return "tags present did not match any V1 extraction rule (see taste-extraction.server.ts)";
}

function explainReviewExclusion(review: any): string {
  const populated = REVIEW_SKIP_FIELDS.filter(f => review[f] != null && review[f] !== "");
  const corePopulated = ["feltLikeHer", "physicallyComfortable", "fitFeedback"].filter(f => review[f] != null);
  if (corePopulated.length === 0 && populated.length > 0) {
    return `only V2-deferred/uncontrolled fields populated: ${populated.join(", ")}`;
  }
  if (review.fitFeedback && review.didWearIt !== "yes") {
    return `fitFeedback present but didWearIt !== "yes" (fit signal requires confirmed wear)`;
  }
  if (corePopulated.length === 0) return "no feltLikeHer / physicallyComfortable / fitFeedback populated";
  return "populated fields did not clear an extraction rule (e.g. fitFeedback 'yes'/'mostly' has no positive V1 rule)";
}

function explainClosetExclusion(item: any): string {
  if (!item.garmentRelationships || item.garmentRelationships.length === 0) return "no garmentRelationships tagged on this item";
  const skipped = item.garmentRelationships.filter((r: string) => CLOSET_SKIP_RELATIONSHIPS.has(r));
  if (skipped.length === item.garmentRelationships.length) return `only relationships with no V1 extraction rule: ${item.garmentRelationships.join(", ")}`;
  return "garmentRelationships present did not match a scored rule";
}

function explainBuySkipExclusion(outcome: any, category: string | null): string {
  if (!category) return "BuyOrSkipAnalysis.category is null — garment-category evidence requires it";
  if (!outcome.postPurchaseOutcome) return "no postPurchaseOutcome recorded yet (decision made, outcome not reported)";
  if (outcome.postPurchaseOutcome === "ITS_OKAY") return `postPurchaseOutcome is "ITS_OKAY" — V1 only extracts LOVE_IT / RETURNED_IT`;
  return "unrecognized state";
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function buildTasteEvidenceDiagnosticReport(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, shopifyCustomerId: true, email: true, createdAt: true },
  });
  if (!customer) {
    throw new Error("customer not found");
  }
  const cid = customer.id;

  // ── 1. Live DB state (ground truth the page currently reads) ──────────────

  const liveEvidence = await prisma.tasteEvidence.findMany({
    where: { customerId: cid },
    select: { source: true, sourceRecordId: true, dimension: true, value: true, polarity: true, strength: true, occurredAt: true },
  });
  const liveTendencies = await prisma.styleTendency.findMany({
    where: { customerId: cid },
    orderBy: [{ observationKey: "asc" }, { generation: "desc" }],
    select: {
      observationKey: true, dimension: true, value: true, generation: true, state: true,
      wSupport: true, wContradict: true, wNet: true, effectiveSupport: true,
      distinctRecords: true, distinctSources: true, dominantPolarity: true,
      observationFamily: true, customerFeedback: true, customerFeedbackAt: true,
    },
  });
  const liveEvidenceBySource: Record<string, number> = {};
  for (const ev of liveEvidence) liveEvidenceBySource[ev.source] = (liveEvidenceBySource[ev.source] ?? 0) + 1;

  // ── 2. Raw source records ──────────────────────────────────────────────────

  const styleMeOutcomes = await prisma.styleMeOutcome.findMany({
    where: { customerId: cid },
    include: { suggestion: { include: { session: { select: { currentMood: true, occasion: true } } } } },
  });
  const postWearReviews = await prisma.postOutfitReview.findMany({
    where: { customerId: cid },
    include: { session: { select: { currentMood: true, occasion: true } } },
  });
  const closetItems = await prisma.closetItem.findMany({
    where: { customerId: cid },
    select: { id: true, customerId: true, category: true, garmentRelationships: true, updatedAt: true },
  });
  const buySkipAnalyses = await prisma.buyOrSkipAnalysis.findMany({
    where: { customerId: cid },
    include: { outcome: { select: { id: true, postPurchaseOutcome: true, createdAt: true } } },
  });

  // ── 3. Re-run the real extraction functions (pure, no DB writes) ──────────

  const freshRows: TasteEvidenceInsert[] = [];
  const excluded: Array<{ source: string; sourceRecordId: string; reason: string }> = [];

  for (const outcome of styleMeOutcomes) {
    const rows = extractStyleMeEvidence(outcome as any, {
      currentMood: outcome.suggestion?.session?.currentMood ?? null,
      occasion: outcome.suggestion?.session?.occasion ?? null,
    });
    if (rows.length === 0) excluded.push({ source: "STYLEME_OUTCOME", sourceRecordId: outcome.id, reason: explainStyleMeExclusion(outcome) });
    freshRows.push(...rows);
  }
  for (const review of postWearReviews) {
    const rows = extractPostWearEvidence(review as any, {
      currentMood: review.session?.currentMood ?? null,
      occasion: review.session?.occasion ?? null,
    });
    if (rows.length === 0) excluded.push({ source: "POST_OUTFIT_REVIEW", sourceRecordId: review.id, reason: explainReviewExclusion(review) });
    freshRows.push(...rows);
  }
  for (const item of closetItems) {
    const rows = extractClosetEvidence(item as any);
    if (rows.length === 0) excluded.push({ source: "CLOSET_RELATIONSHIP", sourceRecordId: item.id, reason: explainClosetExclusion(item) });
    freshRows.push(...rows);
  }
  for (const analysis of buySkipAnalyses) {
    if (!analysis.outcome) {
      excluded.push({ source: "BUYSKIP_OUTCOME", sourceRecordId: analysis.id, reason: "no BuySkipOutcome recorded (decision made, no post-purchase outcome yet)" });
      continue;
    }
    const outcome = analysis.outcome;
    const rows = extractBuySkipEvidence({
      id: outcome.id,
      customerId: cid,
      postPurchaseOutcome: outcome.postPurchaseOutcome,
      category: analysis.category,
      createdAt: outcome.createdAt,
    });
    if (rows.length === 0) excluded.push({ source: "BUYSKIP_OUTCOME", sourceRecordId: outcome.id, reason: explainBuySkipExclusion(outcome, analysis.category) });
    freshRows.push(...rows);
  }

  const freshEvidenceBySource: Record<string, number> = {};
  for (const r of freshRows) freshEvidenceBySource[r.source] = (freshEvidenceBySource[r.source] ?? 0) + 1;

  // ── 4. Grouped claims from both live-stored and freshly-derived evidence ──

  const liveClaims = groupClaims(liveEvidence as EvRow[]);
  const freshClaims = groupClaims(freshRows as unknown as EvRow[]);

  const stalenessFlags: string[] = [];
  for (const src of new Set([...Object.keys(liveEvidenceBySource), ...Object.keys(freshEvidenceBySource)])) {
    const live = liveEvidenceBySource[src] ?? 0;
    const fresh = freshEvidenceBySource[src] ?? 0;
    if (live !== fresh) stalenessFlags.push(`${src}: stored=${live} vs freshly-derivable=${fresh} — stored TasteEvidence is stale relative to raw source records`);
  }

  // ── 5. garment-category fragmentation / casing check ──────────────────────

  const closetCategoryValues = new Set(closetItems.map(i => i.category));
  const buySkipCategoryValues = new Set(buySkipAnalyses.map(a => a.category).filter(Boolean) as string[]);
  const allCategoryValuesRaw = new Set([...closetCategoryValues, ...buySkipCategoryValues]);
  const caseInsensitiveGroups = new Map<string, Set<string>>();
  for (const v of allCategoryValuesRaw) {
    const k = v.toLowerCase();
    const set = caseInsensitiveGroups.get(k) ?? new Set();
    set.add(v);
    caseInsensitiveGroups.set(k, set);
  }
  const casingCollisions = [...caseInsensitiveGroups.values()].filter(s => s.size > 1).map(s => [...s]);

  const garmentCategoryClaims = freshClaims.filter(c => c.dimension === "garment-category");
  const garmentCategoryFragmentation = {
    distinctCategoryValuesWithEvidence: garmentCategoryClaims.length,
    recordCountPerCategory: garmentCategoryClaims.map(c => ({ value: c.value, recordCount: c.recordCount, state: c.resultingState })),
    casingCollisionsAcrossSources: casingCollisions, // e.g. [["DRESSES", "Dresses"]] would mean the same real category is split by casing
  };

  // ── 6. Top claims + nearest-to-Candidate ───────────────────────────────────

  const top20 = freshClaims.slice(0, 20);
  const nearCandidate = freshClaims
    .filter(c => c.resultingState !== "CANDIDATE")
    .map(c => ({
      ...c,
      distanceScore: Math.max(0, c.gapToCandidate.effectiveSupport) + Math.max(0, c.gapToCandidate.wNet) + Math.max(0, c.gapToCandidate.distinctRecords) * 0.5,
    }))
    .filter(c => c.weightedPositive + c.weightedNegative > 0)
    .sort((a, b) => a.distanceScore - b.distanceScore)
    .slice(0, 15);

  const hasAtLeastOneCandidateOrBetter = freshClaims.some(c => c.resultingState === "CANDIDATE" || c.resultingState === "CONFIRMED");

  return {
    customer: { id: customer.id, shopifyCustomerId: customer.shopifyCustomerId, email: customer.email, createdAt: customer.createdAt },
    rawSourceRecordCounts: {
      styleMeOutcomes: styleMeOutcomes.length,
      postOutfitReviews: postWearReviews.length,
      closetItems: closetItems.length,
      buySkipAnalyses: buySkipAnalyses.length,
      buySkipAnalysesWithOutcome: buySkipAnalyses.filter(a => a.outcome).length,
    },
    liveDbState: {
      totalTasteEvidenceRecords: liveEvidence.length,
      totalStyleTendencyRecords: liveTendencies.length,
      evidenceCountsBySource: liveEvidenceBySource,
      storedTendencies: liveTendencies,
      groupedClaimsFromStoredEvidence: liveClaims,
    },
    freshExtractionCheck: {
      note: "Re-derived by calling the real, unmodified extraction functions over raw source records. Compare evidenceCountsBySource below to liveDbState.evidenceCountsBySource above — any mismatch means stored TasteEvidence is stale (a backfill/write-path bug), not a thresholding problem.",
      totalFreshlyDerivedEvidenceRows: freshRows.length,
      evidenceCountsBySource: freshEvidenceBySource,
      stalenessFlags,
      excludedRecords: excluded,
      excludedRecordCount: excluded.length,
      totalRawRecordsExamined: styleMeOutcomes.length + postWearReviews.length + closetItems.length + buySkipAnalyses.filter(a => a.outcome).length,
    },
    groupedClaims: freshClaims,
    garmentCategoryFragmentation,
    top20StrongestClaims: top20,
    nearestClaimsBelowCandidate: nearCandidate,
    summary: {
      hasAtLeastOneCandidateOrBetter,
      totalDistinctDimensionValueGroups: freshClaims.length,
      thresholdsUsed: {
        CANDIDATE_EFFECTIVE_SUPPORT, CANDIDATE_WNET, CANDIDATE_DISTINCT_RECORDS,
        CONFIRMED_EFFECTIVE_SUPPORT, CONFIRMED_WNET, CONFIRMED_DISTINCT_RECORDS,
        SUPPRESS_RATIO, CONTEST_RATIO, CROSS_SOURCE_BONUS,
      },
    },
  };
}
