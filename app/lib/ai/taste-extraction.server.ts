// app/lib/ai/taste-extraction.server.ts
// Phase 5D — Taste Evidence extraction functions.
// Pure functions: no DB calls. Each takes a validated source record and returns
// TasteEvidenceInsert rows ready for DB insert.
//
// Extraction rules follow the approved V1 design spec exactly.

import {
  type TasteEvidenceInsert,
  type TastePolarity,
  type TasteSource,
  SOURCE_BASE_STRENGTH,
  clampStrength,
} from "./taste-contract.js";

// ── Deduplication within a single source record ────────────────────────────────
// When two extraction rules from the same source record map to the same
// (dimension, value, polarity), keep only the stronger one.

function dedupRows(rows: TasteEvidenceInsert[]): TasteEvidenceInsert[] {
  const seen = new Map<string, TasteEvidenceInsert>();
  for (const row of rows) {
    const key = `${row.source}|${row.sourceRecordId}|${row.dimension}|${row.value}|${row.polarity}`;
    const existing = seen.get(key);
    if (!existing || row.strength > existing.strength) {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values());
}

function makeRow(
  customerId: string,
  source: TasteSource,
  sourceRecordId: string,
  dimension: string,
  value: string,
  polarity: TastePolarity,
  strength: number,
  occurredAt: Date,
  extractionRule: string,
  sourceFields: string[],
  rawValues: string[],
  context?: { mood?: string | null; occasion?: string | null },
): TasteEvidenceInsert {
  return {
    customerId,
    source,
    sourceRecordId,
    dimension,
    value,
    polarity,
    strength: clampStrength(strength),
    context,
    provenance: { extractionRule, sourceFields, rawValues },
    occurredAt,
  };
}

// ── Source: STYLEME_OUTCOME ────────────────────────────────────────────────────

interface StyleMeOutcomeForExtraction {
  id:               string;
  customerId:       string;
  outcomeStatus:    string;
  changeTypes:      string[];
  goalOutcome:      string | null;
  whatWorked:       string[];
  whatFeltOff:      string[];
  didntWearReasons: string[];
  submittedAt:      string | Date;
}

interface SessionContext {
  currentMood?: string | null;
  occasion?:    string | null;
}

export function extractStyleMeEvidence(
  outcome: StyleMeOutcomeForExtraction,
  session?: SessionContext,
): TasteEvidenceInsert[] {
  const rows: TasteEvidenceInsert[] = [];
  const base  = SOURCE_BASE_STRENGTH.STYLEME_OUTCOME;
  const id    = outcome.id;
  const cid   = outcome.customerId;
  const ctx   = session ? { mood: session.currentMood, occasion: session.occasion } : undefined;
  const at    = outcome.submittedAt instanceof Date ? outcome.submittedAt : new Date(outcome.submittedAt);

  // Outcome quality modifier — applied to positive and negative separately
  function qualityMod(forPolarity: TastePolarity): number {
    const status = outcome.outcomeStatus;
    const goal   = outcome.goalOutcome;
    if (status === "wore-it") {
      if (forPolarity === "positive") {
        return goal === "yes" ? 1.0 : goal === "somewhat" ? 0.7 : 0.4;
      } else {
        return goal === "yes" ? 0.6 : goal === "somewhat" ? 0.9 : 1.0;
      }
    }
    if (status === "changed-something") {
      return forPolarity === "positive" ? 0.8 : 1.0;
    }
    // didnt-wear-it
    return forPolarity === "positive" ? 0.0 : 0.5;
  }

  const posMod = qualityMod("positive");
  const negMod = qualityMod("negative");

  // whatWorked — positive signals
  for (const tag of outcome.whatWorked) {
    if (tag === "felt-like-me") {
      const s = base * posMod;
      if (s > 0) rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "self-expression", "self-expression", "positive", s, at, "whatWorked:felt-like-me", ["whatWorked"], [tag], ctx));
    }
    // felt-confident → SKIP (correction #2)
    // comfortable
    if (tag === "comfortable") {
      const s = base * posMod;
      if (s > 0) rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "comfort", "comfort", "positive", s, at, "whatWorked:comfortable", ["whatWorked"], [tag], ctx));
    }
    // got-compliments, occasion-right, other → SKIP
  }

  // whatFeltOff — negative signals
  for (const tag of outcome.whatFeltOff) {
    if (tag === "didnt-feel-like-me") {
      const s = base * negMod;
      rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "self-expression", "self-expression", "negative", s, at, "whatFeltOff:didnt-feel-like-me", ["whatFeltOff"], [tag], ctx));
    }
    if (tag === "uncomfortable") {
      const s = base * negMod;
      rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "comfort", "comfort", "negative", s, at, "whatFeltOff:uncomfortable", ["whatFeltOff"], [tag], ctx));
    }
    if (tag === "fit-issue") {
      const s = base * negMod;
      rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "fit", "fit", "negative", s, at, "whatFeltOff:fit-issue", ["whatFeltOff"], [tag], ctx));
    }
    if (tag === "too-formal") {
      const s = base * negMod;
      rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "formality", "too-formal", "negative", s, at, "whatFeltOff:too-formal", ["whatFeltOff"], [tag], ctx));
    }
    if (tag === "too-casual") {
      const s = base * negMod;
      rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "formality", "too-casual", "negative", s, at, "whatFeltOff:too-casual", ["whatFeltOff"], [tag], ctx));
    }
    // wrong-colour, other → SKIP
  }

  // changeTypes — negative signals (what had to be changed = friction signal)
  for (const ct of outcome.changeTypes) {
    if (ct === "more-comfortable") {
      const s = base * negMod;
      rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "comfort", "comfort", "negative", s, at, "changeTypes:more-comfortable", ["changeTypes"], [ct], ctx));
    }
    if (ct === "different-fit") {
      const s = base * negMod;
      rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "fit", "fit", "negative", s, at, "changeTypes:different-fit", ["changeTypes"], [ct], ctx));
    }
    if (ct === "less-formal") {
      const s = base * negMod;
      rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "formality", "too-formal", "negative", s, at, "changeTypes:less-formal", ["changeTypes"], [ct], ctx));
    }
    // shoes, top, bottom, layer, more-coverage, different-colour, other → SKIP
  }

  // didntWearReasons — only style-relevant reasons; apply didnt-wear modifier (0.5)
  if (outcome.outcomeStatus === "didnt-wear-it") {
    for (const reason of outcome.didntWearReasons) {
      if (reason === "comfort-concern") {
        const s = base * negMod;
        rows.push(makeRow(cid, "STYLEME_OUTCOME", id, "comfort", "comfort", "negative", s, at, "didntWearReasons:comfort-concern", ["didntWearReasons"], [reason], ctx));
      }
      // style-mood-changed → SKIP (correction #2)
      // weather, plans-changed, not-ready, other → SKIP
    }
  }

  return dedupRows(rows);
}

// ── Source: POST_OUTFIT_REVIEW ─────────────────────────────────────────────────

interface PostOutfitReviewForExtraction {
  id:                   string;
  customerId:           string;
  overallFeeling?:      number | null;
  feltLikeHer?:         string | null;
  physicallyComfortable?: string | null;
  wouldWearAgain?:      string | null;
  feelingAnswer?:       string | null;  // Phase 4B1: great | good | okay | not-great
  fitFeedback?:         string | null;  // Phase 4B1: yes | mostly | no
  didWearIt?:           string | null;  // Phase 4B1: yes | not-yet | no
  createdAt:            Date | string;
}

function reviewQualityModifier(review: PostOutfitReviewForExtraction): number {
  let feelingMod = 1.0;
  if (review.feelingAnswer) {
    const map: Record<string, number> = { great: 1.0, good: 0.85, okay: 0.6, "not-great": 0.4 };
    feelingMod = map[review.feelingAnswer] ?? 1.0;
  } else if (review.overallFeeling != null) {
    feelingMod = Math.max(0.4, Math.min(1.0, review.overallFeeling / 5.0));
  }

  let wearMod = 1.0;
  if (review.wouldWearAgain) {
    const w = review.wouldWearAgain.toLowerCase().replace(/\s+/g, "-");
    if (w === "definitely") wearMod = 1.1;
    else if (w === "probably-not") wearMod = 0.7;
  }

  return feelingMod * wearMod;
}

function normalizeComfort(raw: string | null | undefined): "positive" | "weak-positive" | "negative" | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "comfortable" || v === "yes") return "positive";
  if (v === "mostly comfortable" || v === "mostly") return "weak-positive";
  if (v === "not comfortable" || v === "not-comfortable" || v === "no") return "negative";
  return null;
}

export function extractPostWearEvidence(
  review: PostOutfitReviewForExtraction,
  session?: SessionContext,
): TasteEvidenceInsert[] {
  const rows: TasteEvidenceInsert[] = [];
  const base = SOURCE_BASE_STRENGTH.POST_OUTFIT_REVIEW;
  const id   = review.id;
  const cid  = review.customerId;
  const ctx  = session ? { mood: session.currentMood, occasion: session.occasion } : undefined;
  const at   = review.createdAt instanceof Date ? review.createdAt : new Date(review.createdAt);
  const mod  = reviewQualityModifier(review);

  // feltLikeHer → self-expression
  if (review.feltLikeHer) {
    const v = review.feltLikeHer.toLowerCase();
    if (v === "yes") {
      rows.push(makeRow(cid, "POST_OUTFIT_REVIEW", id, "self-expression", "self-expression", "positive", base * mod, at, "feltLikeHer:yes", ["feltLikeHer"], [review.feltLikeHer], ctx));
    } else if (v === "somewhat") {
      rows.push(makeRow(cid, "POST_OUTFIT_REVIEW", id, "self-expression", "self-expression", "positive", base * 0.4, at, "feltLikeHer:somewhat", ["feltLikeHer"], [review.feltLikeHer], ctx));
    } else if (v === "no") {
      rows.push(makeRow(cid, "POST_OUTFIT_REVIEW", id, "self-expression", "self-expression", "negative", base, at, "feltLikeHer:no", ["feltLikeHer"], [review.feltLikeHer], ctx));
    }
  }

  // physicallyComfortable → comfort (handles both legacy and Phase 4B1 vocabularies)
  const comfortSignal = normalizeComfort(review.physicallyComfortable);
  if (comfortSignal === "positive") {
    rows.push(makeRow(cid, "POST_OUTFIT_REVIEW", id, "comfort", "comfort", "positive", base * mod, at, "physicallyComfortable:positive", ["physicallyComfortable"], [review.physicallyComfortable!], ctx));
  } else if (comfortSignal === "weak-positive") {
    rows.push(makeRow(cid, "POST_OUTFIT_REVIEW", id, "comfort", "comfort", "positive", base * 0.5, at, "physicallyComfortable:weak-positive", ["physicallyComfortable"], [review.physicallyComfortable!], ctx));
  } else if (comfortSignal === "negative") {
    rows.push(makeRow(cid, "POST_OUTFIT_REVIEW", id, "comfort", "comfort", "negative", base, at, "physicallyComfortable:negative", ["physicallyComfortable"], [review.physicallyComfortable!], ctx));
  }

  // fitFeedback → fit NEGATIVE only; only when didWearIt == "yes"
  if (review.fitFeedback && review.didWearIt === "yes") {
    if (review.fitFeedback === "no") {
      rows.push(makeRow(cid, "POST_OUTFIT_REVIEW", id, "fit", "fit", "negative", base, at, "fitFeedback:no", ["fitFeedback", "didWearIt"], [review.fitFeedback, review.didWearIt], ctx));
    }
    // "yes" / "mostly" → no positive fit signal in V1
  }

  // desiredFeelingAchieved → SKIP (correction #2)
  // workedTags / didntWorkTags → SKIP (uncontrolled vocabulary)
  // colourFeedback / coverageFeedback → SKIP (V2)

  return dedupRows(rows);
}

// ── Source: CLOSET_RELATIONSHIP ────────────────────────────────────────────────

interface ClosetItemForExtraction {
  id:                   string;
  customerId:           string;
  category:             string;
  garmentRelationships: string[];
  updatedAt:            Date | string;
}

export function extractClosetEvidence(
  item: ClosetItemForExtraction,
): TasteEvidenceInsert[] {
  const rows: TasteEvidenceInsert[] = [];
  const base = SOURCE_BASE_STRENGTH.CLOSET_RELATIONSHIP;
  const id   = item.id;
  const cid  = item.customerId;
  const cat  = item.category;  // ClosetCategory enum value (e.g. "DRESSES")
  const at   = item.updatedAt instanceof Date ? item.updatedAt : new Date(item.updatedAt);

  // Only the first qualifying relationship (max 2 allowed; take the strongest)
  // favourite > wear-often (positive) | regret > rarely-wear (negative)
  let bestPositive: { rule: string; strength: number } | null = null;
  let bestNegative: { rule: string; strength: number } | null = null;

  for (const rel of item.garmentRelationships) {
    if (rel === "favourite")   { if (!bestPositive || 1.0 > bestPositive.strength) bestPositive = { rule: rel, strength: 1.0 }; }
    if (rel === "wear-often")  { if (!bestPositive || 0.8 > bestPositive.strength) bestPositive = { rule: rel, strength: 0.8 }; }
    if (rel === "regret")      { if (!bestNegative || 1.0 > bestNegative.strength) bestNegative = { rule: rel, strength: 1.0 }; }
    if (rel === "rarely-wear") { if (!bestNegative || 0.7 > bestNegative.strength) bestNegative = { rule: rel, strength: 0.7 }; }
    // love-style-struggle, like, unsure, occasion-only → SKIP
  }

  if (bestPositive) {
    rows.push(makeRow(cid, "CLOSET_RELATIONSHIP", id, "garment-category", cat, "positive", base * bestPositive.strength, at, `garmentRelationships:${bestPositive.rule}`, ["garmentRelationships", "category"], [bestPositive.rule, cat]));
  }
  if (bestNegative) {
    rows.push(makeRow(cid, "CLOSET_RELATIONSHIP", id, "garment-category", cat, "negative", base * bestNegative.strength, at, `garmentRelationships:${bestNegative.rule}`, ["garmentRelationships", "category"], [bestNegative.rule, cat]));
  }

  return dedupRows(rows);
}

// ── Source: BUYSKIP_OUTCOME ────────────────────────────────────────────────────

interface BuySkipOutcomeForExtraction {
  id:                  string;
  customerId:          string;   // resolved via analysis join
  postPurchaseOutcome: string | null;  // LOVE_IT | ITS_OKAY | RETURNED_IT
  category:            string | null;  // from BuyOrSkipAnalysis
  createdAt:           Date | string;
}

export function extractBuySkipEvidence(
  outcome: BuySkipOutcomeForExtraction,
): TasteEvidenceInsert[] {
  const rows: TasteEvidenceInsert[] = [];
  const base = SOURCE_BASE_STRENGTH.BUYSKIP_OUTCOME;

  // Skip if no category or no conclusive outcome
  if (!outcome.category || !outcome.postPurchaseOutcome) return rows;
  if (outcome.postPurchaseOutcome === "ITS_OKAY") return rows;
  // STILL_DECIDING on decision is filtered before calling (outcome only exists after decision set)

  const id  = outcome.id;
  const cid = outcome.customerId;
  const cat = outcome.category;
  const at  = outcome.createdAt instanceof Date ? outcome.createdAt : new Date(outcome.createdAt);

  if (outcome.postPurchaseOutcome === "LOVE_IT") {
    rows.push(makeRow(cid, "BUYSKIP_OUTCOME", id, "garment-category", cat, "positive", base * 1.0, at, "postPurchaseOutcome:LOVE_IT", ["postPurchaseOutcome", "category"], [outcome.postPurchaseOutcome, cat]));
  } else if (outcome.postPurchaseOutcome === "RETURNED_IT") {
    rows.push(makeRow(cid, "BUYSKIP_OUTCOME", id, "garment-category", cat, "negative", base * 1.0, at, "postPurchaseOutcome:RETURNED_IT", ["postPurchaseOutcome", "category"], [outcome.postPurchaseOutcome, cat]));
  }

  return dedupRows(rows);
}
