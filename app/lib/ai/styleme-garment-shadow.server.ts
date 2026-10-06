// app/lib/ai/styleme-garment-shadow.server.ts
//
// Garment Intelligence — Phase 2: StyleMe shadow comparison.
//
// Diagnostic-only. No live StyleMe generation/ranking/gating file imports
// this module, and this module never imports any of them back in a way
// that could create a path for a canonical value to reach a live
// decision — it reads already-exported pure functions from StyleMe/GI
// modules read-only, the same way any other diagnostic script would.
//
// Purpose: for a given raw Closet item (already carrying styleMeProfile
// and adminReview), compare "what would current live StyleMe read about
// this item" against "what does the canonical ResolvedGarment say" —
// field by field, with an honest reason for every divergence. This does
// NOT recreate StyleMe's candidate generation, ranking, or gating; it
// only reads the same raw/curated fields StyleMe's own loader
// (loadAllClosetItemsForEngine) already reads, via a small projection
// kept intentionally narrow to "what StyleMe currently sees" — not a
// second universal garment type.
//
// Layer boundary: this module and resolveGarment() never read Shared
// Customer Intelligence, StyleMe demand/outcomes, Buy-or-Skip, or
// wardrobe-gap findings. Garment Intelligence remains garment truth only.

import { getEffectiveClosetItem, type ClosetItemFields } from "~/lib/admin/closet-review.server";
import { ALL_INTENTIONS, type StylingPassportInput } from "~/lib/admin/garment-intelligence-v1.server";
import { closetItemToSlot } from "~/lib/ai/closet-slot";
import { computeEnergyPotential } from "~/lib/ai/styleme-anchor.server";
import {
  resolveGarment,
  CURATED_WEIGHT_MAP,
  CURATED_STRENGTH_MAP,
  type ResolvableClosetItem,
} from "~/lib/ai/resolved-garment.server";

// ── StyleMe-view projection ──────────────────────────────────────────────────
//
// The smallest explicit representation of what StyleMe's own loader
// (loadAllClosetItemsForEngine, styleme-anchor.server.ts) actually reads
// for the fields this comparison covers. Deliberately reflects CURRENT
// LIVE semantics (raw fields, no admin-override merge; approved-profile
// fields read directly) — not canonical semantics. This is not a second
// universal garment type; its only job is answering "what would current
// StyleMe read about this item".

export interface StyleMeGarmentView {
  id: string;
  category: string;
  subcategory: string | null;
  slot: string;
  primaryColor: string | null;
  colors: string[];
  silhouette: string | null;
  fitProfile: string | null;
  formality: string | null;
  sleeveLength: string | null;
  necklineCoverage: string | null;
  hemLength: string | null;
  topLength: string | null;
  midriffExposed: boolean | null;
  shoulderCoverage: boolean | null;
  /** Raw approved-profile value, title case, e.g. "heavy" — null when there
   * is no approved profile. This is what StyleMe actually reads; it is
   * NOT run through CURATED_WEIGHT_MAP here, so the heavy/substantial
   * mismatch stays visible rather than being normalized away. */
  approvedVisualWeight: string | null;
  /** Raw approved-profile intention map, title case — null when there is
   * no approved profile. */
  approvedIntentionPotentials: Record<string, string> | null;
  /** StyleMe's own non-curated heuristic (computeEnergyPotential,
   * styleme-anchor.server.ts) — a 0-3 count, NOT on the light/medium/
   * heavy-or-substantial scale. Reported separately; never coerced into
   * a comparison with ResolvedGarment.visualWeight. */
  energyHeuristic: number;
}

export function toStyleMeGarmentView(item: ResolvableClosetItem): StyleMeGarmentView {
  const p = item.styleMeProfile;
  const approved = p && p.profileStatus === "approved" ? p : null;
  return {
    id: item.id,
    category: item.category,
    subcategory: item.subcategory ?? null,
    slot: closetItemToSlot(item.category, item.subcategory ?? null),
    primaryColor: item.primaryColor ?? null,
    colors: item.colors ?? [],
    silhouette: item.silhouette ?? null,
    fitProfile: item.fitProfile ?? null,
    formality: item.formality ?? null,
    sleeveLength: item.sleeveLength ?? null,
    necklineCoverage: item.necklineCoverage ?? null,
    hemLength: item.hemLength ?? null,
    topLength: item.topLength ?? null,
    midriffExposed: item.midriffExposed ?? null,
    shoulderCoverage: item.shoulderCoverage ?? null,
    approvedVisualWeight: approved?.visualWeight ?? null,
    approvedIntentionPotentials: (approved?.intentionPotentials as Record<string, string> | null) ?? null,
    energyHeuristic: computeEnergyPotential({
      styleTags: item.styleTags ?? [], pattern: item.pattern ?? null,
      fitProfile: item.fitProfile ?? null, silhouette: item.silhouette ?? null,
    }),
  };
}

// ── Comparison rows ──────────────────────────────────────────────────────────

export const COMPARISON_REASONS = [
  "admin-override-blindness",
  "approved-profile-difference",
  "vocabulary-mismatch",
  "algorithm-difference",
  "missing-styleme-concept",
  "missing-canonical-concept",
  "known-frozen-wi-bug",
  "other",
] as const;
export type ComparisonReason = (typeof COMPARISON_REASONS)[number];

export interface FieldComparison {
  garmentId: string;
  field: string;
  styleMeValue: unknown;
  canonicalValue: unknown;
  comparable: boolean;
  /** null/omitted-in-spirit for non-comparable concepts — still present
   * as `null` here (not `undefined`) so every row has the same shape. */
  same: boolean | null;
  reason: ComparisonReason | null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function row(garmentId: string, field: string, styleMeValue: unknown, canonicalValue: unknown, overrideKeyPresent: boolean): FieldComparison {
  const same = valuesEqual(styleMeValue, canonicalValue);
  return {
    garmentId, field, styleMeValue, canonicalValue, comparable: true, same,
    reason: same ? null : (overrideKeyPresent ? "admin-override-blindness" : "other"),
  };
}

/** Observable fields where StyleMe reads raw and ResolvedGarment reads
 * effective (admin-override-aware) — any mismatch here can only be
 * explained by an admin observable override, since neither side derives
 * these from anything else. */
const OBSERVABLE_COMPARISON_FIELDS = [
  "subcategory", "primaryColor", "colors", "silhouette", "fitProfile", "formality",
  "sleeveLength", "necklineCoverage", "hemLength", "topLength", "midriffExposed", "shoulderCoverage",
] as const;

const KNOWN_FROZEN_WI_BUG_INTENTIONS = new Set(["ground-me", "feel-attractive", "feel-less-exposed"]);

/**
 * One garment in, every comparable (and explicitly-marked non-comparable)
 * field out. Never recreates StyleMe's candidate generation, ranking, or
 * gating — reads only the same raw/curated fields StyleMe's own loader
 * already reads, via toStyleMeGarmentView(), plus resolveGarment()'s
 * already-computed canonical output.
 */
export function compareStyleMeGarmentToResolvedGarment(
  item: ResolvableClosetItem,
  passportInput: StylingPassportInput | null,
): FieldComparison[] {
  const view = toStyleMeGarmentView(item);
  const canonical = resolveGarment(item, passportInput);
  const overrides = (item.adminReview?.overrides ?? null) as Partial<ClosetItemFields> | null;
  const hasOverrideKey = (key: string) => Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, key));

  const rows: FieldComparison[] = [];

  // category / slot — category is never overridable; slot is derived from
  // subcategory on both sides, so it inherits subcategory's override-driven
  // divergence rather than having a cause of its own.
  rows.push(row(item.id, "category", view.category, canonical.category, false));
  rows.push(row(item.id, "slot", view.slot, canonical.slot, hasOverrideKey("subcategory")));

  for (const field of OBSERVABLE_COMPARISON_FIELDS) {
    rows.push(row(item.id, field, (view as any)[field], (canonical as any)[field], hasOverrideKey(field)));
  }

  // ── Visual weight — three values, never coerced into one comparison ──────
  const intelligenceOverrides = (item.adminReview?.intelligenceOverrides ?? null) as { visualWeight?: unknown } | null;
  const hasVisualWeightOverride = Boolean(intelligenceOverrides && Object.prototype.hasOwnProperty.call(intelligenceOverrides, "visualWeight"));
  if (view.approvedVisualWeight && CURATED_WEIGHT_MAP[view.approvedVisualWeight]) {
    const mapped = CURATED_WEIGHT_MAP[view.approvedVisualWeight];
    const same = mapped === canonical.visualWeight;
    rows.push({
      garmentId: item.id, field: "visualWeight", styleMeValue: view.approvedVisualWeight, canonicalValue: canonical.visualWeight,
      comparable: true, same,
      // The canonical heavy->substantial mapping is already applied before
      // this comparison (CURATED_WEIGHT_MAP) — this is the approved
      // production normalization path, not an invented equivalence. A
      // mismatch after that mapping can only mean an admin
      // intelligenceOverrides.visualWeight exists on top of the approved
      // profile, which StyleMe never reads.
      reason: same ? null : (hasVisualWeightOverride ? "admin-override-blindness" : "other"),
    });
  } else {
    // No approved profile (or no visualWeight on it) — StyleMe has no
    // single curated value to compare; it only has the non-curated
    // energyHeuristic, which lives on a different scale entirely and is
    // reported separately (view.energyHeuristic), never coerced here.
    rows.push({
      garmentId: item.id, field: "visualWeight", styleMeValue: null, canonicalValue: canonical.visualWeight,
      comparable: false, same: null, reason: "missing-styleme-concept",
    });
  }

  // ── Intentions — curated-overlap vs algorithm-difference, kept separate ──
  for (const intention of ALL_INTENTIONS) {
    const curatedRaw = view.approvedIntentionPotentials?.[intention];
    const canonicalValue = canonical.intentions?.[intention] ?? null;
    if (typeof curatedRaw === "string" && CURATED_STRENGTH_MAP[curatedRaw]) {
      // Curated-overlap: both sides originate from the same approved value.
      const mapped = CURATED_STRENGTH_MAP[curatedRaw];
      const overridesIntentions = (item.adminReview?.intelligenceOverrides ?? null) as { intentions?: Record<string, unknown> } | null;
      const hasIntentionOverride = Boolean(overridesIntentions?.intentions && Object.prototype.hasOwnProperty.call(overridesIntentions.intentions, intention) && overridesIntentions.intentions[intention] !== null);
      const same = mapped === canonicalValue;
      rows.push({
        garmentId: item.id, field: `intention:${intention}`, styleMeValue: curatedRaw, canonicalValue,
        comparable: true, same,
        reason: same ? null : (hasIntentionOverride ? "admin-override-blindness" : "other"),
      });
    } else {
      // Algorithm comparison: StyleMe falls back to formCharacterScore /
      // legacyPieceIntentionScore heuristics (not reproduced here — those
      // are per-candidate-set heuristics, not a single per-garment value,
      // and recreating them would duplicate StyleMe's own ranking logic).
      // Canonical falls back to garment-intelligence-v1 derived strength.
      // These are never counted as a truth disagreement.
      rows.push({
        garmentId: item.id, field: `intention:${intention}`, styleMeValue: null, canonicalValue,
        comparable: false, same: null,
        reason: KNOWN_FROZEN_WI_BUG_INTENTIONS.has(intention) ? "known-frozen-wi-bug" : "algorithm-difference",
      });
    }
  }

  return rows;
}

// ── Admin-override-blindness summary ─────────────────────────────────────────
//
// Mirrors closet-review.server.ts's ALLOWED_OVERRIDE_KEYS (not exported
// there, so listed again here as read-only diagnostic vocabulary — not a
// second copy of the override-application logic, just the field names).
const OBSERVABLE_OVERRIDE_KEYS = [
  "subcategory", "silhouette", "fitProfile", "hemLength", "topLength",
  "waistShape", "sleeveLength", "necklineCoverage", "shoulderCoverage",
  "midriffExposed", "material", "pattern", "primaryColor", "colors",
  "occasions", "seasons", "formality", "styleTags", "stylePersonality",
] as const;

export interface AdminOverrideFieldSummary {
  field: string;
  garmentsWithOverride: number;
  valueChangingOverrides: number;
  styleMeCanonicalDivergences: number;
}

/**
 * For every admin-overridable observable field, across a set of items:
 * how many have the override present at all, how many of those actually
 * change the value (vs. an admin re-confirming the same value), and how
 * many of those are things current StyleMe would get wrong (raw vs
 * effective). The third column is, by construction, identical to the
 * second here — StyleMe's raw read only ever differs from the override-
 * applied effective value when the override is value-changing. That
 * identity IS the measurement: it confirms override-blindness fully
 * explains StyleMe's divergence on these fields, not a coincidence.
 */
export function summarizeAdminOverrideBlindness(items: readonly ResolvableClosetItem[]): AdminOverrideFieldSummary[] {
  return OBSERVABLE_OVERRIDE_KEYS.map((field) => {
    let garmentsWithOverride = 0;
    let valueChangingOverrides = 0;
    let divergences = 0;
    for (const item of items) {
      const overrides = (item.adminReview?.overrides ?? null) as Record<string, unknown> | null;
      if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, field)) continue;
      garmentsWithOverride++;
      const effective = getEffectiveClosetItem(item, item.adminReview) as unknown as Record<string, unknown>;
      const raw = (item as unknown as Record<string, unknown>)[field];
      if (!valuesEqual(raw, effective[field])) {
        valueChangingOverrides++;
        divergences++; // StyleMe reads raw; canonical reads effective — this IS the divergence.
      }
    }
    return { field, garmentsWithOverride, valueChangingOverrides, styleMeCanonicalDivergences: divergences };
  });
}

// ── Aggregation ──────────────────────────────────────────────────────────────

export interface AggregateFieldRow {
  field: string;
  compared: number;
  same: number;
  different: number;
  divergencePercent: number;
  nonComparable: number;
  primaryReasons: Partial<Record<ComparisonReason, number>>;
}

/** Non-comparable rows never enter the divergence denominator. */
export function aggregateFieldComparisons(allRows: readonly FieldComparison[]): AggregateFieldRow[] {
  const byField = new Map<string, FieldComparison[]>();
  for (const r of allRows) {
    const arr = byField.get(r.field) ?? [];
    arr.push(r);
    byField.set(r.field, arr);
  }
  const result: AggregateFieldRow[] = [];
  for (const [field, rows] of byField) {
    const comparableRows = rows.filter((r) => r.comparable);
    const nonComparable = rows.length - comparableRows.length;
    const same = comparableRows.filter((r) => r.same).length;
    const different = comparableRows.length - same;
    const primaryReasons: Partial<Record<ComparisonReason, number>> = {};
    for (const r of rows) {
      if (r.reason) primaryReasons[r.reason] = (primaryReasons[r.reason] ?? 0) + 1;
    }
    result.push({
      field, compared: comparableRows.length, same, different,
      divergencePercent: comparableRows.length > 0 ? Math.round((different / comparableRows.length) * 1000) / 10 : 0,
      nonComparable, primaryReasons,
    });
  }
  return result;
}
