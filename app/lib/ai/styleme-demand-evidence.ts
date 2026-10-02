/**
 * StyleMe-demand evidence — V1.
 *
 * This is demand evidence, not preference evidence: a repeated request tells
 * nAia what the customer keeps asking StyleMe to help her dress for. It never
 * says she liked, wore, or would buy anything StyleMe generated, and it never
 * touches Passport or Closet structural truth. See
 * wardrobe-feedback-evidence.ts for the separate StyleMe-OUTCOME layer this
 * is deliberately NOT merged with in V1.
 *
 * Event identity, locked by the real-data validation pass before this file
 * existed:
 *   - The dedup key is the full explicit request — raw (normalized) occasion,
 *     the register it was already resolved to, formalityConditional, the
 *     canonical intention set, closetAnchorId and styleFrom. Two requests
 *     that differ in ANY of these are different asks, even when they land on
 *     the same register. Register-level aggregation happens strictly AFTER
 *     event dedup, never instead of it.
 *   - Within one dedup key, requests inside DEMAND_RETRY_WINDOW_MS of the
 *     previous one in that same key collapse into a single event — this is
 *     retry/regeneration behaviour, confirmed against real near-duplicate
 *     bursts (sub-second to a few minutes apart, parentSessionId always
 *     null). Outside the window, even same-day, each occurrence is its own
 *     event — recurring demand is real signal, not noise to collapse away.
 *   - A cluster of sessions sharing the EXACT same createdAt millisecond is
 *     a data-quality exclusion, not a semantic claim about StyleMe: no two
 *     independent human submissions land on the same millisecond, and
 *     across the full real dataset checked, every collision group found was
 *     exactly one known-contaminated block. This is named and documented as
 *     a provisional heuristic (see SUSPICIOUS_COLLISION_GROUP_MIN_SIZE) —
 *     not hardcoded to any date, and not asserted as a permanent truth.
 */

import { norm } from "~/lib/ai/wardrobe-intelligence";

/**
 * Provisional data-quality heuristic, not a semantic truth about StyleMe:
 * a customer's sessions sharing the exact same createdAt millisecond, at or
 * above this count, are treated as synthetic/seeded and contribute ZERO
 * demand events (never "one deduped real request"). Chosen as the smallest
 * value that is empirically safe against the full dataset checked before
 * this file existed: every collision group found there — of any size — was
 * exactly one 118-row seeded block; no group of size 2–4 occurs naturally.
 * Revisit this constant, not the exclusion mechanism, if real near-
 * simultaneous duplicate submissions are ever confirmed to exist.
 */
export const SUSPICIOUS_COLLISION_GROUP_MIN_SIZE = 2;

/** Requests sharing an identical dedup key within this many milliseconds of
 * the previous one in that key collapse into a single demand event. */
export const DEMAND_RETRY_WINDOW_MS = 2 * 60 * 1000;

/**
 * STYLEME_DEMAND is deliberately a recent-history signal, not an all-time
 * one: it exists to compare against the Closet's CURRENT depth, and an
 * all-time count would conflate demand from however long ago StyleMe usage
 * began with what she needs today. 90 days (one season) is long enough to
 * carry real recurring signal and short enough to stay current — a named,
 * documented, adjustable choice, not a row-count cap standing in for one.
 */
export const STYLEME_DEMAND_WINDOW_DAYS = 90;

/**
 * The trailing-window cutoff, with an explicit `asOf` seam so the boundary
 * is deterministic and testable rather than depending on an inline
 * `Date.now()`. Production callers may omit `asOf` (defaults to now);
 * tests must supply a fixed one.
 */
export function demandWindowCutoff(asOf: Date = new Date()): Date {
  return new Date(asOf.getTime() - STYLEME_DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Legacy pre-Rev3 `desiredFeeling` -> modern `intentions` id, for the five
 * values whose wording is an unambiguous match against the real option
 * lists in feeling.tsx / intention.tsx. Every other legacy value (including
 * `more-effortless`, a soft but not identical match) is deliberately left
 * unmapped — V1 prefers dropping uncertain legacy evidence over inventing an
 * equivalence the UI copy doesn't actually support. `currentMood` has no
 * entry here at all: it answers "how do you feel right now" (the same
 * question modern `state` asks, which the schema itself documents as
 * wording context only) rather than "what do you want", so it is excluded
 * from demand entirely, not merely unmapped.
 */
const LEGACY_FEELING_TO_INTENTION: Readonly<Record<string, string>> = {
  "more-confident": "confidence",
  "more-put-together": "feel-put-together",
  "more-attractive": "feel-attractive",
  "like-myself": "feel-like-myself",
  softer: "feel-softer",
};

/**
 * One raw StyleMe request, as read from a StylingSession row. `register` is
 * passed in already resolved by the caller (via the existing
 * styleMeSessionRegister()) rather than recomputed here — this module has no
 * dependency on wardrobe-needs.ts, which avoids a circular import back to
 * the module that will consume this one's output.
 */
export interface RawStyleMeDemandFact {
  sessionId: string;
  createdAt: Date;
  occasion: string | null;
  register: string | null;
  formalityConditional: string | null;
  intentions: readonly string[];
  /** Legacy pre-Rev3 field. Normalized into `intentions` here, not by the
   * caller, so the mapping table above has one home and one set of tests. */
  desiredFeeling: string | null;
  closetAnchorId: string | null;
  styleFrom: string;
}

export interface DemandEvent {
  /** The earliest session in this collapsed cluster — an arbitrary but
   * documented choice of representative, not a claim that later retries
   * within the window didn't happen. */
  sessionId: string;
  createdAt: Date;
  occasion: string | null;
  register: string | null;
  /** Canonicalized (Rev3 ids + any mapped legacy feeling), deduped, sorted. */
  intentions: readonly string[];
}

export interface RegisterDemandCount {
  register: string;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface IntentionDemandCount {
  intention: string;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface StyleMeDemandDerivation {
  events: DemandEvent[];
  registerDemand: RegisterDemandCount[];
  intentionDemand: IntentionDemandCount[];
  /** Raw rows dropped as synthetic collision groups — contributed nothing. */
  syntheticExcludedCount: number;
  /** Raw rows absorbed into an earlier event by the retry window. */
  retriesCollapsedCount: number;
}

function canonicalIntentions(fact: RawStyleMeDemandFact): string[] {
  const mapped = fact.desiredFeeling ? LEGACY_FEELING_TO_INTENTION[fact.desiredFeeling] : undefined;
  const set = new Set(fact.intentions);
  if (mapped) set.add(mapped);
  return [...set].sort();
}

function dedupKey(fact: RawStyleMeDemandFact, canonical: readonly string[]): string {
  const EMPTY = "∅";
  return [
    norm(fact.occasion) ?? EMPTY,
    fact.register ?? EMPTY,
    // formalityConditional values are already clean machine tokens
    // ("formality-smart", etc.) — no free-text casing/spacing variance to
    // normalize away, unlike occasion.
    fact.formalityConditional ?? EMPTY,
    canonical.join(","),
    fact.closetAnchorId ?? EMPTY,
    fact.styleFrom,
  ].join("|");
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function deriveStyleMeDemand(rawFacts: readonly RawStyleMeDemandFact[]): StyleMeDemandDerivation {
  // ── 1. Exclude synthetic collision groups ──────────────────────────────
  const byExactTimestamp = new Map<number, RawStyleMeDemandFact[]>();
  for (const fact of rawFacts) {
    const t = fact.createdAt.getTime();
    const group = byExactTimestamp.get(t);
    if (group) group.push(fact);
    else byExactTimestamp.set(t, [fact]);
  }
  let syntheticExcludedCount = 0;
  const clean: RawStyleMeDemandFact[] = [];
  for (const group of byExactTimestamp.values()) {
    if (group.length >= SUSPICIOUS_COLLISION_GROUP_MIN_SIZE) {
      syntheticExcludedCount += group.length;
      continue;
    }
    clean.push(...group);
  }

  // ── 2. Group by the full explicit-request dedup key, collapse retries ──
  const byKey = new Map<string, Array<{ fact: RawStyleMeDemandFact; canonical: string[] }>>();
  for (const fact of clean) {
    const canonical = canonicalIntentions(fact);
    const key = dedupKey(fact, canonical);
    const group = byKey.get(key);
    const entry = { fact, canonical };
    if (group) group.push(entry);
    else byKey.set(key, [entry]);
  }

  const events: DemandEvent[] = [];
  let retriesCollapsedCount = 0;
  for (const group of byKey.values()) {
    group.sort((a, b) => a.fact.createdAt.getTime() - b.fact.createdAt.getTime());
    let current = group[0];
    let lastTime = current.fact.createdAt.getTime();
    for (let i = 1; i < group.length; i++) {
      const item = group[i];
      const t = item.fact.createdAt.getTime();
      if (t - lastTime <= DEMAND_RETRY_WINDOW_MS) {
        retriesCollapsedCount += 1;
        lastTime = t;
        continue; // absorbed into `current` — same explicit request, retried
      }
      events.push(toEvent(current));
      current = item;
      lastTime = t;
    }
    events.push(toEvent(current));
  }

  // ── 3. Aggregate register/intention demand from the deduped events only ─
  const registerMap = new Map<string, { count: number; first: Date; last: Date }>();
  const intentionMap = new Map<string, { count: number; first: Date; last: Date }>();
  for (const event of events) {
    if (event.register) accumulate(registerMap, event.register, event.createdAt);
    for (const intention of event.intentions) accumulate(intentionMap, intention, event.createdAt);
  }

  const registerDemand = [...registerMap.entries()]
    .map(([register, v]) => ({ register, eventCount: v.count, firstSeen: toISODate(v.first), lastSeen: toISODate(v.last) }))
    .sort((a, b) => b.eventCount - a.eventCount);
  const intentionDemand = [...intentionMap.entries()]
    .map(([intention, v]) => ({ intention, eventCount: v.count, firstSeen: toISODate(v.first), lastSeen: toISODate(v.last) }))
    .sort((a, b) => b.eventCount - a.eventCount);

  return { events, registerDemand, intentionDemand, syntheticExcludedCount, retriesCollapsedCount };
}

function toEvent(entry: { fact: RawStyleMeDemandFact; canonical: string[] }): DemandEvent {
  return {
    sessionId: entry.fact.sessionId,
    createdAt: entry.fact.createdAt,
    occasion: entry.fact.occasion,
    register: entry.fact.register,
    intentions: entry.canonical,
  };
}

function accumulate(map: Map<string, { count: number; first: Date; last: Date }>, key: string, at: Date): void {
  const entry = map.get(key);
  if (!entry) {
    map.set(key, { count: 1, first: at, last: at });
    return;
  }
  entry.count += 1;
  if (at < entry.first) entry.first = at;
  if (at > entry.last) entry.last = at;
}
