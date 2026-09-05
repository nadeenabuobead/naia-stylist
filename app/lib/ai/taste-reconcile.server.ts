// app/lib/ai/taste-reconcile.server.ts
// Phase 5D — Taste Evidence DB lifecycle + weighted reconciliation engine.
//
// writeSourceEvidence: delete-and-reinsert pattern for one source record, then reconcile.
// reconcileObservations: full reconciliation pass for a customer.

import prisma from "../../db.server.js";
import {
  type TasteEvidenceInsert,
  type TasteSource,
  type TasteState,
  type ObservationFamily,
  makeObservationKey,
  generateTendencyText,
  CANDIDATE_EFFECTIVE_SUPPORT,
  CANDIDATE_WNET,
  CANDIDATE_DISTINCT_RECORDS,
  CONFIRMED_EFFECTIVE_SUPPORT,
  CONFIRMED_WNET,
  CONFIRMED_DISTINCT_RECORDS,
  SUPPRESS_RATIO,
  CONTEST_RATIO,
  CROSS_SOURCE_BONUS,
  REEMERGENCE_SUPPORT_MULTIPLIER,
  REEMERGENCE_DISTINCT_RECORDS,
  REEMERGENCE_WNET_MINIMUM,
} from "./taste-contract.js";
import { applyFeedbackWithDeps } from "./taste-feedback-engine.js";

// ── Write source evidence (delete-and-reinsert + reconcile) ───────────────────

export async function writeSourceEvidence(
  customerId: string,
  source: TasteSource,
  sourceRecordId: string,
  rows: TasteEvidenceInsert[],
): Promise<void> {
  // Delete all existing evidence for this (customerId, source, sourceRecordId)
  await prisma.tasteEvidence.deleteMany({
    where: { customerId, source, sourceRecordId },
  });

  // Insert new rows (may be empty if record has no extractable evidence)
  if (rows.length > 0) {
    await prisma.tasteEvidence.createMany({
      data: rows.map(r => ({
        customerId:     r.customerId,
        source:         r.source,
        sourceRecordId: r.sourceRecordId,
        dimension:      r.dimension,
        value:          r.value,
        polarity:       r.polarity,
        strength:       r.strength,
        context:        r.context ?? null,
        provenance:     r.provenance,
        occurredAt:     r.occurredAt,
      })),
      skipDuplicates: true,
    });
  }

  // Reconcile affected dimension:value pairs
  await reconcileObservations(customerId);
}

// ── Aggregate type ─────────────────────────────────────────────────────────────

interface DimAggregate {
  dimension:        string;
  value:            string;
  wPositive:        number;
  wNegative:        number;
  distinctPositiveRecords: number;
  distinctNegativeRecords: number;
  distinctPositiveSources: number;
  distinctNegativeSources: number;
  latestOccurredAt: Date | null;
  allSourcesUsed:   string[];
}

// ── Contradiction classification ───────────────────────────────────────────────

type ContradictionClass = "SUPPRESSED" | "CANDIDATE_ONLY" | "CONFIRMED_ELIGIBLE";

function classifyContradiction(wSupport: number, wContradict: number): ContradictionClass {
  if (wSupport === 0) return "SUPPRESSED";
  if (wContradict >= wSupport * SUPPRESS_RATIO)  return "SUPPRESSED";
  if (wContradict >= wSupport * CONTEST_RATIO)   return "CANDIDATE_ONLY";
  return "CONFIRMED_ELIGIBLE";
}

// ── State determination ────────────────────────────────────────────────────────

function computeState(
  effectiveSupport: number,
  wNet: number,
  distinctRecords: number,
  contradictionClass: ContradictionClass,
  customerFeedback: string | null,
): TasteState {
  // Customer REJECTED is always authoritative
  if (customerFeedback === "not-quite") return "REJECTED";

  if (contradictionClass === "SUPPRESSED") return "SUPPRESSED";

  const meetsConfirmed =
    effectiveSupport >= CONFIRMED_EFFECTIVE_SUPPORT &&
    wNet              >= CONFIRMED_WNET &&
    distinctRecords   >= CONFIRMED_DISTINCT_RECORDS;

  const meetsCandidate =
    effectiveSupport >= CANDIDATE_EFFECTIVE_SUPPORT &&
    wNet              >= CANDIDATE_WNET &&
    distinctRecords   >= CANDIDATE_DISTINCT_RECORDS;

  if (meetsConfirmed && contradictionClass === "CONFIRMED_ELIGIBLE") return "CONFIRMED";
  if (meetsCandidate) return "CANDIDATE";
  return "SUPPRESSED";
}

// ── Reconcile observations for a customer ─────────────────────────────────────

export async function reconcileObservations(customerId: string): Promise<void> {
  // Load all evidence for this customer
  const allEvidence = await prisma.tasteEvidence.findMany({
    where: { customerId },
    select: {
      id: true,
      source: true,
      sourceRecordId: true,
      dimension: true,
      value: true,
      polarity: true,
      strength: true,
      occurredAt: true,
    },
  });

  // Load all existing StyleTendency rows for this customer (all generations)
  const allTendencies = await prisma.styleTendency.findMany({
    where: { customerId },
  });

  // Group tendencies by observationKey, ordered by generation desc
  const tendencyByKey = new Map<string, typeof allTendencies>();
  for (const t of allTendencies) {
    const existing = tendencyByKey.get(t.observationKey) ?? [];
    existing.push(t);
    tendencyByKey.set(t.observationKey, existing);
  }
  // Sort each group descending by generation
  for (const [key, group] of tendencyByKey) {
    tendencyByKey.set(key, group.sort((a, b) => b.generation - a.generation));
  }

  // Group evidence by (dimension, value) — aggregate all unconditionally first
  const dimValueMap = new Map<string, typeof allEvidence>();
  for (const ev of allEvidence) {
    const key = `${ev.dimension}|${ev.value}`;
    const existing = dimValueMap.get(key) ?? [];
    existing.push(ev);
    dimValueMap.set(key, existing);
  }

  // Track which (dimension, value) pairs have been processed — for demotion below
  const processedKeys = new Set<string>();

  // Process each (dimension, value) group
  for (const [dimValKey, evidenceRows] of dimValueMap) {
    const [dimension, value] = dimValKey.split("|");
    const observationKey = makeObservationKey(dimension, value);
    processedKeys.add(observationKey);

    // Find existing tendency generations for this key
    const existingGens = tendencyByKey.get(observationKey) ?? [];
    const latestGen = existingGens[0] ?? null;  // highest generation first

    // Determine evidence cutoff for the current generation
    // Generation N uses only evidence after generation (N-1)'s rejection timestamp
    let evidenceCutoff: Date | null = null;
    if (latestGen && latestGen.state === "REJECTED" && latestGen.customerFeedbackAt) {
      // Check re-emergence: is there enough new evidence to create a new generation?
      evidenceCutoff = latestGen.customerFeedbackAt;
      const postEvidence = evidenceRows.filter(ev => ev.occurredAt > evidenceCutoff!);
      const postAggregate = aggregateEvidence(postEvidence);

      // Find dominant polarity of post-correction evidence
      const postDominant = postAggregate.wPositive >= postAggregate.wNegative ? "positive" : "negative";
      const postWSupport  = postDominant === "positive" ? postAggregate.wPositive : postAggregate.wNegative;
      const postWContradict = postDominant === "positive" ? postAggregate.wNegative : postAggregate.wPositive;
      const postDistinctRecords = postDominant === "positive" ? postAggregate.distinctPositiveRecords : postAggregate.distinctNegativeRecords;
      const postWNet = postWSupport - postWContradict;

      const meetsReemergence =
        postWSupport        >= CONFIRMED_EFFECTIVE_SUPPORT * REEMERGENCE_SUPPORT_MULTIPLIER &&
        postDistinctRecords >= REEMERGENCE_DISTINCT_RECORDS &&
        postWNet            >= REEMERGENCE_WNET_MINIMUM;

      if (!meetsReemergence) {
        // Update the rejected generation's post-correction tracking metrics
        await prisma.styleTendency.update({
          where: { id: latestGen.id },
          data: {
            wSupportSinceCorrection:        postWSupport,
            distinctRecordsSinceCorrection: postDistinctRecords,
            updatedAt: new Date(),
          },
        });
        continue;  // Not enough new evidence yet — skip
      }

      // Enough new evidence — create a new generation
      const newGeneration = latestGen.generation + 1;
      // New generation's evidence window begins after the rejected gen's correction
      const newEvidenceCutoff = latestGen.customerFeedbackAt;
      const newGenEvidence = evidenceRows.filter(ev => ev.occurredAt > newEvidenceCutoff);
      await upsertTendency(customerId, observationKey, dimension, value, newGeneration, newGenEvidence, null);
      continue;
    }

    // Active generation (CANDIDATE, CONFIRMED, or SUPPRESSED — not REJECTED)
    // Evidence cutoff: if there's a REJECTED generation behind this one, find its cutoff
    let activeGenCutoff: Date | null = null;
    if (latestGen && latestGen.state !== "REJECTED") {
      // Look for a preceding rejected generation
      const rejectedBelow = existingGens.find(g => g.state === "REJECTED" && g.generation < latestGen.generation);
      if (rejectedBelow && rejectedBelow.customerFeedbackAt) {
        activeGenCutoff = rejectedBelow.customerFeedbackAt;
      }
    } else if (!latestGen) {
      // No existing tendency — generation 1, no cutoff
      activeGenCutoff = null;
    }

    const windowEvidence = activeGenCutoff
      ? evidenceRows.filter(ev => ev.occurredAt > activeGenCutoff!)
      : evidenceRows;

    const currentGeneration = latestGen && latestGen.state !== "REJECTED" ? latestGen.generation : 1;
    const customerFeedback  = latestGen && latestGen.state !== "REJECTED" ? latestGen.customerFeedback : null;

    await upsertTendency(customerId, observationKey, dimension, value, currentGeneration, windowEvidence, customerFeedback);
  }

  // Demote any tendency that no longer has supporting evidence
  for (const [, genGroup] of tendencyByKey) {
    const latest = genGroup[0];
    if (!latest) continue;
    if (latest.state === "REJECTED") continue;  // Never touch rejected rows
    if (!processedKeys.has(latest.observationKey)) {
      // No evidence group for this key — demote to SUPPRESSED
      if (latest.state !== "SUPPRESSED") {
        await prisma.styleTendency.update({
          where: { id: latest.id },
          data: { state: "SUPPRESSED", updatedAt: new Date() },
        });
      }
    }
  }
}

// ── Aggregate evidence for a set of rows ──────────────────────────────────────

function aggregateEvidence(evidenceRows: Array<{
  source: string; sourceRecordId: string; polarity: string; strength: number; occurredAt: Date;
}>): {
  wPositive: number; wNegative: number;
  distinctPositiveRecords: number; distinctNegativeRecords: number;
  distinctPositiveSources: number; distinctNegativeSources: number;
  latestOccurredAt: Date | null;
  allSourcesUsed: string[];
} {
  let wPositive = 0, wNegative = 0;
  const posRecords = new Set<string>();
  const negRecords = new Set<string>();
  const posSources = new Set<string>();
  const negSources = new Set<string>();
  const allSources = new Set<string>();
  let latestOccurredAt: Date | null = null;

  for (const ev of evidenceRows) {
    allSources.add(ev.source);
    if (!latestOccurredAt || ev.occurredAt > latestOccurredAt) latestOccurredAt = ev.occurredAt;
    const compositeId = `${ev.source}|${ev.sourceRecordId}`;
    if (ev.polarity === "positive") {
      wPositive += ev.strength;
      posRecords.add(compositeId);
      posSources.add(ev.source);
    } else {
      wNegative += ev.strength;
      negRecords.add(compositeId);
      negSources.add(ev.source);
    }
  }

  return {
    wPositive, wNegative,
    distinctPositiveRecords: posRecords.size,
    distinctNegativeRecords: negRecords.size,
    distinctPositiveSources: posSources.size,
    distinctNegativeSources: negSources.size,
    latestOccurredAt,
    allSourcesUsed: Array.from(allSources),
  };
}

// ── Upsert a single tendency generation ───────────────────────────────────────

async function upsertTendency(
  customerId: string,
  observationKey: string,
  dimension: string,
  value: string,
  generation: number,
  evidenceRows: Array<{ source: string; sourceRecordId: string; polarity: string; strength: number; occurredAt: Date }>,
  customerFeedback: string | null,
): Promise<void> {
  const agg = aggregateEvidence(evidenceRows);

  // Dominant polarity
  const dominantPolarity = agg.wPositive >= agg.wNegative ? "positive" : "negative";
  const wSupport    = dominantPolarity === "positive" ? agg.wPositive  : agg.wNegative;
  const wContradict = dominantPolarity === "positive" ? agg.wNegative  : agg.wPositive;
  const distinctRecords = dominantPolarity === "positive" ? agg.distinctPositiveRecords : agg.distinctNegativeRecords;
  const distinctSources = dominantPolarity === "positive" ? agg.distinctPositiveSources : agg.distinctNegativeSources;
  const wNet = wSupport - wContradict;

  const crossSourceBonus = distinctSources >= 2 ? CROSS_SOURCE_BONUS : 1.0;
  const effectiveSupport = wSupport * crossSourceBonus;

  const contradictionClass = classifyContradiction(wSupport, wContradict);
  const state = computeState(effectiveSupport, wNet, distinctRecords, contradictionClass, customerFeedback);

  const observationFamily: ObservationFamily = dominantPolarity === "positive" ? "WORKS_WELL" : "FRICTION";

  // Generate text for CANDIDATE and CONFIRMED
  let claimText: string | null = null;
  let rationaleText: string | null = null;
  if (state === "CANDIDATE" || state === "CONFIRMED") {
    const texts = generateTendencyText(dimension, value, observationFamily, distinctRecords, distinctSources, agg.allSourcesUsed);
    claimText     = texts.claimText;
    rationaleText = texts.rationaleText;
  }

  // Upsert by (customerId, observationKey, generation)
  const existing = await prisma.styleTendency.findFirst({
    where: { customerId, observationKey, generation },
  });

  if (existing) {
    // Preserve customerFeedback if REJECTED (never overwrite it)
    if (existing.state === "REJECTED") return;

    await prisma.styleTendency.update({
      where: { id: existing.id },
      data: {
        dominantPolarity,
        observationFamily,
        state,
        wSupport,
        wContradict,
        wNet,
        distinctRecords,
        distinctSources,
        effectiveSupport,
        lastEvidenceAt:   agg.latestOccurredAt,
        claimText:        claimText    ?? existing.claimText,
        rationaleText:    rationaleText ?? existing.rationaleText,
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.styleTendency.create({
      data: {
        customerId,
        observationKey,
        dimension,
        value,
        generation,
        dominantPolarity,
        observationFamily,
        state,
        wSupport,
        wContradict,
        wNet,
        distinctRecords,
        distinctSources,
        effectiveSupport,
        wSupportSinceCorrection:        0,
        distinctRecordsSinceCorrection: 0,
        lastEvidenceAt:   agg.latestOccurredAt,
        claimText,
        rationaleText,
        claimVersion:     1,
        customerFeedback: null,
        customerFeedbackAt: null,
        updatedAt: new Date(),
      },
    });
  }
}

// ── Apply customer feedback (accurate | not-quite) ────────────────────────────

export async function applyTasteObservationFeedback(
  customerId: string,
  tendencyId: string,
  feedback: "accurate" | "not-quite",
): Promise<{ ok: boolean; errorCode?: string }> {
  return applyFeedbackWithDeps(
    {
      findTendency:  (id, cid) => prisma.styleTendency.findFirst({ where: { id, customerId: cid } }),
      writeFeedback: (id, data) => prisma.styleTendency.update({ where: { id }, data }).then(() => undefined),
      runReconcile:  (cid) => reconcileObservations(cid),
    },
    customerId,
    tendencyId,
    feedback,
  );
}

// ── Load CONFIRMED observations for overview ───────────────────────────────────

export async function loadStrongestConfirmedTendency(customerId: string) {
  return prisma.styleTendency.findFirst({
    where: {
      customerId,
      state:            "CONFIRMED",
      customerFeedback: { not: "not-quite" },
    },
    orderBy: { effectiveSupport: "desc" },
    select: {
      id:               true,
      dimension:        true,
      value:            true,
      observationFamily: true,
      claimText:        true,
      rationaleText:    true,
    },
  });
}

// ── Load observations for What nAia Is Noticing page ─────────────────────────

export async function loadConfirmedTendencies(customerId: string) {
  // Per concept (observationKey), return highest-generation non-REJECTED row
  const allActive = await prisma.styleTendency.findMany({
    where: {
      customerId,
      state: { in: ["CANDIDATE", "CONFIRMED"] },
      customerFeedback: { not: "not-quite" },
    },
    orderBy: [
      { observationKey: "asc" },
      { generation: "desc" },
    ],
  });

  // Deduplicate: take highest generation per observationKey
  const seen = new Set<string>();
  const deduped = allActive.filter(t => {
    if (seen.has(t.observationKey)) return false;
    seen.add(t.observationKey);
    return true;
  });

  const confirmed = deduped.filter(t => t.state === "CONFIRMED").slice(0, 5);
  const candidateCount = deduped.filter(t => t.state === "CANDIDATE").length;

  return { confirmed, candidateCount };
}
