// app/lib/ai/tryon-orchestration.ts
// Phase 4A7 — Complete-look orchestration and single-garment gating.
// Pure functions; no server imports. All dependency on eligibility state is injected.

import { isTryOnEligible } from "./tryon-product-eligibility.js";
import type { TryOnGateResult } from "./tryon-entry-point.js";

// ── Garment reference ─────────────────────────────────────────────────────────

export interface GarmentRef {
  handle: string;
  title: string;
  itemType: string; // "TOP" | "BOTTOM" | "DRESS" | "OUTERWEAR" | other
}

// ── FASHN layering order ──────────────────────────────────────────────────────
// Bottoms must render before tops so FASHN correctly layers the outfit.
// Outerwear always last so it sits on top of all layers.

const ITEM_TYPE_ORDER: Record<string, number> = {
  BOTTOM: 0,
  TOP: 1,
  DRESS: 2,
  OUTERWEAR: 3,
};

// ── buildCompleteLookGarments ─────────────────────────────────────────────────
// Filters to try-on-eligible garments and returns them in FASHN layering order.
// Garments with unrecognised itemType sort to the end.

export function buildCompleteLookGarments(
  garments: GarmentRef[],
  _isTryOnEligible: (handle: string) => boolean = isTryOnEligible,
): GarmentRef[] {
  return [...garments]
    .filter((g) => _isTryOnEligible(g.handle))
    .sort((a, b) => (ITEM_TYPE_ORDER[a.itemType] ?? 99) - (ITEM_TYPE_ORDER[b.itemType] ?? 99));
}

// ── gateSingleGarment ─────────────────────────────────────────────────────────
// Gate a single-garment CTA.
// feature-disabled always wins regardless of garment eligibility.

export function gateSingleGarment(
  handle: string,
  featureEnabled: boolean,
  _isTryOnEligible: (handle: string) => boolean = isTryOnEligible,
): TryOnGateResult {
  if (!featureEnabled) return { allowed: false, reason: "feature-disabled" };
  if (!_isTryOnEligible(handle)) return { allowed: false, reason: "garment-not-eligible" };
  return { allowed: true };
}

// ── gateCompleteLook ──────────────────────────────────────────────────────────
// Gate a complete-look CTA.
// Returns the filtered and ordered eligible garments alongside the gate result.
// allowed is true only when at least one garment passes eligibility.

export function gateCompleteLook(
  garments: GarmentRef[],
  featureEnabled: boolean,
  _isTryOnEligible: (handle: string) => boolean = isTryOnEligible,
): { allowed: boolean; eligibleGarments: GarmentRef[]; gateReason?: TryOnGateResult["reason"] } {
  if (!featureEnabled) {
    return { allowed: false, eligibleGarments: [], gateReason: "feature-disabled" };
  }
  const eligible = buildCompleteLookGarments(garments, _isTryOnEligible);
  if (eligible.length === 0) {
    return { allowed: false, eligibleGarments: [], gateReason: "garment-not-eligible" };
  }
  return { allowed: true, eligibleGarments: eligible };
}
